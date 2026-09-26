const express = require('express');
const logger = require('./logger');
const {
  register,
  paymentRequestsTotal,
  paymentSuccessTotal,
  paymentFailureTotal,
  paymentRequestDurationSeconds,
  paymentActiveConnections,
  paymentFailureMode,
  paymentDbErrorsTotal
} = require('./metrics');

const app = express();
const port = process.env.PORT || 4002;

app.use(express.json());

// In-memory runtime state (real state of this process)
let inFlightRequests = 0;
const failureState = {
  active: false,
  mode: 'none',
  since: null
};

// Middleware: Track active connections and response time
app.use((req, res, next) => {
  inFlightRequests++;
  if (!failureState.active || failureState.mode !== 'db_overload') {
    paymentActiveConnections.set(inFlightRequests);
  }

  res.on('finish', () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
    if (!failureState.active || failureState.mode !== 'db_overload') {
      paymentActiveConnections.set(inFlightRequests);
    }
  });
  next();
});

// 1. Health Endpoint
app.get('/health', (req, res) => {
  const isHealthy = !failureState.active;
  const status = isHealthy ? 'UP' : (failureState.mode === 'downstream_failure' ? 'DOWN' : 'DEGRADED');

  const healthPayload = {
    status,
    service: 'payment-service',
    port: Number(port),
    failureMode: failureState.mode,
    activeConnections: inFlightRequests,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  };

  if (!isHealthy && failureState.mode === 'downstream_failure') {
    return res.status(503).json(healthPayload);
  }

  return res.status(200).json(healthPayload);
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

// 3. Payment API: Charge
app.post('/api/charge', async (req, res) => {
  const startTime = process.hrtime();
  const { orderId, amount, currency = 'USD', customerId } = req.body;

  // Validate input
  if (!orderId || amount === undefined || typeof amount !== 'number' || amount <= 0) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    paymentRequestsTotal.inc({ route: '/api/charge', status_code: '400' });
    paymentFailureTotal.inc({ reason: 'invalid_payload' });
    paymentRequestDurationSeconds.observe({ route: '/api/charge', status_code: '400' }, duration);

    logger.warn('Payment rejected: Invalid charge payload', { orderId, amount, customerId });
    return res.status(400).json({
      success: false,
      error: 'Invalid payment payload. Positive numeric amount and orderId are required.'
    });
  }

  // --- FAILURE MODE EXECUTION ---
  if (failureState.active) {
    // Mode A: Database connection pool exhaustion / overload
    if (failureState.mode === 'db_overload') {
      paymentActiveConnections.set(98); // Realistically saturated pool
      paymentDbErrorsTotal.inc();
      paymentFailureTotal.inc({ reason: 'db_pool_exhaustion' });
      paymentRequestsTotal.inc({ route: '/api/charge', status_code: '500' });

      // Artificial latency spike typical of connection pool queue timeouts
      await new Promise(r => setTimeout(r, 60));

      const elapsed = process.hrtime(startTime);
      const duration = elapsed[0] + elapsed[1] / 1e9;
      paymentRequestDurationSeconds.observe({ route: '/api/charge', status_code: '500' }, duration);

      logger.error('Payment failed: Database pool exhausted', {
        orderId,
        amount,
        activeConnections: 98,
        maxPool: 100,
        durationSeconds: duration
      });

      return res.status(500).json({
        success: false,
        error: 'ConnectionPoolTimeoutException: Timeout waiting for connection from pool of 100 max connections.',
        orderId,
        failureMode: 'db_overload'
      });
    }

    // Mode B: High CPU exhaustion / Event loop lag
    if (failureState.mode === 'high_cpu') {
      // Synchronous CPU burn simulating intensive computation / crypto lock
      const startLoop = Date.now();
      let x = 0.0001;
      while (Date.now() - startLoop < 80) {
        x += Math.sqrt(x) * Math.sin(x);
      }

      paymentFailureTotal.inc({ reason: 'cpu_exhaustion' });
      paymentRequestsTotal.inc({ route: '/api/charge', status_code: '504' });

      const elapsed = process.hrtime(startTime);
      const duration = elapsed[0] + elapsed[1] / 1e9;
      paymentRequestDurationSeconds.observe({ route: '/api/charge', status_code: '504' }, duration);

      logger.error('Payment timeout: CPU exhaustion and event loop delay', {
        orderId,
        amount,
        durationSeconds: duration
      });

      return res.status(504).json({
        success: false,
        error: 'GatewayTimeout: Payment service worker process event loop lag exceeded threshold (>500ms).',
        orderId,
        failureMode: 'high_cpu'
      });
    }

    // Mode C: Downstream Failure / Process Unresponsive
    paymentFailureTotal.inc({ reason: 'service_unresponsive' });
    paymentRequestsTotal.inc({ route: '/api/charge', status_code: '503' });

    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    paymentRequestDurationSeconds.observe({ route: '/api/charge', status_code: '503' }, duration);

    logger.error('Payment rejected: Service worker thread deadlocked', {
      orderId,
      amount,
      durationSeconds: duration
    });

    return res.status(503).json({
      success: false,
      error: 'ServiceUnavailable: Payment service worker unresponsive or deadlocked.',
      orderId,
      failureMode: failureState.mode
    });
  }

  // --- HEALTHY PROCESSING ---
  // Real processing simulation (realistic payment gateway roundtrip ~20ms)
  await new Promise(r => setTimeout(r, 20));

  const elapsed = process.hrtime(startTime);
  const duration = elapsed[0] + elapsed[1] / 1e9;

  paymentRequestsTotal.inc({ route: '/api/charge', status_code: '200' });
  paymentSuccessTotal.inc();
  paymentRequestDurationSeconds.observe({ route: '/api/charge', status_code: '200' }, duration);

  const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  logger.info('Payment processed successfully', {
    orderId,
    amount,
    currency,
    transactionId,
    durationSeconds: duration
  });

  return res.status(200).json({
    success: true,
    transactionId,
    orderId,
    amount,
    currency,
    status: 'COMPLETED',
    processedAt: new Date().toISOString()
  });
});

// 4. Controlled Failure Simulation Endpoint
app.post('/api/simulate-failure', (req, res) => {
  const { mode = 'db_overload', fail = true } = req.body;

  if (!fail || mode === 'none' || mode === 'reset') {
    // Clear failure
    const prevMode = failureState.mode;
    failureState.active = false;
    failureState.mode = 'none';
    failureState.since = null;

    if (prevMode !== 'none') {
      paymentFailureMode.set({ mode: prevMode }, 0);
    }
    paymentFailureMode.set({ mode: 'none' }, 0);
    paymentActiveConnections.set(inFlightRequests);

    logger.info('Failure simulation cleared. Service healthy.', { previousMode: prevMode });
    return res.json({
      success: true,
      message: 'Failure simulation cleared. Service running in healthy state.',
      failureMode: 'none',
      status: 'HEALTHY'
    });
  }

  // Activate failure
  const previousMode = failureState.mode;
  if (previousMode && previousMode !== 'none') {
    paymentFailureMode.set({ mode: previousMode }, 0);
  }

  failureState.active = true;
  failureState.mode = mode;
  failureState.since = new Date().toISOString();

  paymentFailureMode.set({ mode }, 1);
  if (mode === 'db_overload') {
    paymentActiveConnections.set(98);
  }

  logger.warn('Failure mode activated', {
    mode,
    activatedAt: failureState.since
  });

  return res.json({
    success: true,
    message: `Controlled failure activated: ${mode}`,
    failureMode: mode,
    status: 'DEGRADED'
  });
});

// 5. Remediation Endpoint
app.post('/api/remediate', (req, res) => {
  const { action = 'restart_worker_pool', operator = 'AIOps-SRE-Engine' } = req.body;
  const previousMode = failureState.mode;

  // Restore service to normal operating state
  failureState.active = false;
  failureState.mode = 'none';
  failureState.since = null;

  if (previousMode !== 'none') {
    paymentFailureMode.set({ mode: previousMode }, 0);
  }
  paymentFailureMode.set({ mode: 'none' }, 0);
  paymentActiveConnections.set(inFlightRequests);
  paymentDbErrorsTotal.reset();
  paymentFailureTotal.reset();

  logger.info('Remediation action executed. Service restored to healthy operating baseline.', {
    action,
    operator,
    previousMode
  });

  return res.json({
    success: true,
    message: 'Payment service connection pool drained and restored to healthy baseline.',
    actionExecuted: action,
    status: 'HEALTHY',
    failureMode: 'none'
  });
});

// Startup & Graceful Shutdown
const server = app.listen(port, () => {
  logger.info('Payment Service started successfully', {
    port: Number(port),
    env: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    pid: process.pid
  });
});

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`, { inFlightRequests });
  server.close(() => {
    logger.info('Payment Service HTTP server closed. Process exiting cleanly.');
    process.exit(0);
  });

  // Force close if open sockets take too long
  setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded. Forcing termination.');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };
