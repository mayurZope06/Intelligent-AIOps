const express = require('express');
const logger = require('./logger');
const {
  register,
  authRequestsTotal,
  authSuccessTotal,
  authFailureTotal,
  authFailureMode,
  authRequestDurationSeconds
} = require('./metrics');

const app = express();
const port = process.env.PORT || 4003;

app.use(express.json());

// Failure simulation state
const failureState = {
  active: false,
  mode: 'none',
  since: null
};

// In-flight connection tracker
let inFlightRequests = 0;
app.use((req, res, next) => {
  inFlightRequests++;
  res.on('finish', () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
  });
  next();
});

// 1. Health Endpoint
app.get('/health', (req, res) => {
  const isHealthy = !failureState.active;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    service: 'auth-service',
    port: Number(port),
    failureMode: failureState.mode,
    activeConnections: inFlightRequests,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.error('Failed to export metrics', { error: err.message });
    res.status(500).end(err.message);
  }
});

// 3. Controlled Failure Simulation Endpoint
app.post('/api/simulate-failure', (req, res) => {
  const { mode = 'auth_storm', fail = true } = req.body;

  if (!fail || mode === 'none' || mode === 'reset') {
    const prev = failureState.mode;
    failureState.active = false;
    failureState.mode = 'none';
    failureState.since = null;
    authFailureMode.reset();
    logger.info('Auth failure simulation cleared. Service healthy.', { prev });
    return res.json({
      success: true,
      message: 'Auth Service fault cleared. Service running in healthy state.',
      failureMode: 'none',
      status: 'HEALTHY'
    });
  }

  failureState.active = true;
  failureState.mode = mode;
  failureState.since = new Date().toISOString();
  authFailureMode.set({ mode }, 1);
  authFailureTotal.inc({ reason: 'auth_token_storm' }, 12);

  logger.error('Auth failure simulation activated', { mode });
  return res.json({
    success: true,
    message: `Auth Service fault injected: ${mode}`,
    failureMode: mode,
    status: 'DEGRADED'
  });
});

// 4. Remediation Endpoint
app.post('/api/remediate', (req, res) => {
  const { action = 'flush_cache', operator = 'AIOps Automation' } = req.body;
  const prevMode = failureState.mode;

  failureState.active = false;
  failureState.mode = 'none';
  failureState.since = null;

  authFailureMode.reset();
  authFailureTotal.reset();

  logger.info(`Auth Service remediated via ${action} by ${operator}`, { previousMode: prevMode });
  return res.json({
    success: true,
    message: `Auth Service cache flushed and authentication keys rotated. Telemetry restored.`,
    action,
    operator,
    status: 'HEALTHY'
  });
});

// 5. Verify Identity / Token Endpoint
app.post('/api/verify', (req, res) => {
  const startTime = process.hrtime();
  const { customerId, authHeader } = req.body;

  // Active failure mode simulation
  if (failureState.active) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    authRequestsTotal.inc({ route: '/api/verify', method: 'POST', status_code: '401' });
    authFailureTotal.inc({ reason: 'auth_token_storm' });
    authRequestDurationSeconds.observe({ route: '/api/verify', status_code: '401' }, duration);

    logger.warn('Authentication rejected due to active auth storm', { customerId, mode: failureState.mode });
    return res.status(401).json({
      authenticated: false,
      error: 'Unauthorized: Auth token storm & 401 burst active. Verification cache invalidated.',
      statusCode: 401
    });
  }

  // Rejection check (e.g. invalid credentials or explicit unauthenticated simulation)
  if (customerId === 'unauthorized' || (authHeader && authHeader.includes('invalid'))) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    authRequestsTotal.inc({ route: '/api/verify', method: 'POST', status_code: '401' });
    authFailureTotal.inc({ reason: 'invalid_credentials' });
    authRequestDurationSeconds.observe({ route: '/api/verify', status_code: '401' }, duration);

    logger.warn('Authentication rejected', { customerId, reason: 'invalid_credentials' });
    return res.status(401).json({
      authenticated: false,
      error: 'Unauthorized: Invalid authentication credentials.',
      statusCode: 401
    });
  }

  const elapsed = process.hrtime(startTime);
  const duration = elapsed[0] + elapsed[1] / 1e9;

  authRequestsTotal.inc({ route: '/api/verify', method: 'POST', status_code: '200' });
  authSuccessTotal.inc();
  authRequestDurationSeconds.observe({ route: '/api/verify', status_code: '200' }, duration);

  logger.info('Identity verified successfully', {
    customerId: customerId || 'anonymous_guest',
    durationSeconds: duration
  });

  return res.status(200).json({
    authenticated: true,
    customerId: customerId || 'anonymous_guest',
    roles: ['customer', 'shopper'],
    verifiedAt: new Date().toISOString()
  });
});

// Startup & Graceful Shutdown
const server = app.listen(port, () => {
  logger.info('Auth Service started successfully', {
    port: Number(port),
    env: process.env.NODE_ENV || 'development',
    pid: process.pid
  });
});

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('Auth Service HTTP server closed. Process exiting cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded. Forcing termination.');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };
