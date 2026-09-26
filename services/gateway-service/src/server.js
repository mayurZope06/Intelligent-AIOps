const express = require('express');
const axios = require('axios');
const logger = require('./logger');
const {
  register,
  gatewayRequestsTotal,
  gatewaySuccessTotal,
  gatewayFailureTotal,
  gatewayRequestDurationSeconds,
  gatewayUpstreamErrorsTotal,
  gatewayCheckoutErrorsTotal,
  gatewayFailureMode
} = require('./metrics');

const app = express();
const port = process.env.PORT || 4000;

// Configurable downstream endpoints via environment variables
const orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:4001';
const authServiceUrl = process.env.AUTH_SERVICE_URL || '';
const downstreamTimeoutMs = Number(process.env.DOWNSTREAM_TIMEOUT_MS) || 3000;

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
    service: 'gateway-service',
    port: Number(port),
    failureMode: failureState.mode,
    downstream: {
      orderService: orderServiceUrl,
      authService: authServiceUrl ? authServiceUrl : 'disabled/optional'
    },
    activeConnections: inFlightRequests,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.error('Failed to export metrics', { error: err.message });
    res.status(500).end(err.message);
  }
});

// Controlled Failure Simulation Endpoint
app.post('/api/simulate-failure', (req, res) => {
  const { mode = 'cache_stampede', fail = true } = req.body;

  if (!fail || mode === 'none' || mode === 'reset') {
    const prev = failureState.mode;
    failureState.active = false;
    failureState.mode = 'none';
    failureState.since = null;
    gatewayFailureMode.reset();
    gatewayCheckoutErrorsTotal.reset();
    gatewayUpstreamErrorsTotal.reset();
    gatewayFailureTotal.reset();

    logger.info('Gateway failure simulation cleared. Service healthy.', { prev });
    return res.json({
      success: true,
      message: 'Gateway Service failure cleared.',
      failureMode: 'none',
      status: 'HEALTHY'
    });
  }

  failureState.active = true;
  failureState.mode = mode;
  failureState.since = new Date().toISOString();
  gatewayFailureMode.set({ mode }, 1);
  gatewayCheckoutErrorsTotal.inc(10);
  gatewayUpstreamErrorsTotal.inc({ target_service: 'order-service', error_type: 'ECONNRESET' }, 10);
  gatewayFailureTotal.inc({ reason: mode }, 10);

  logger.error('Gateway failure simulation activated', { mode });
  return res.json({
    success: true,
    message: `Gateway Service failure simulated: ${mode}`,
    failureMode: mode,
    status: 'DEGRADED'
  });
});

// Remediation Endpoint
app.post('/api/remediate', (req, res) => {
  const { action = 'flush_cache', operator = 'AIOps Automation' } = req.body;
  const prevMode = failureState.mode;

  failureState.active = false;
  failureState.mode = 'none';
  failureState.since = null;

  gatewayFailureMode.reset();
  gatewayCheckoutErrorsTotal.reset();
  gatewayUpstreamErrorsTotal.reset();
  gatewayFailureTotal.reset();

  logger.info(`Gateway Service remediated via ${action} by ${operator}`, { previousMode: prevMode });
  res.json({
    success: true,
    message: 'Gateway Service cache flushed and upstream error counters reset.',
    action,
    operator,
    status: 'HEALTHY'
  });
});

// 3. Checkout Public Entry Point
app.post('/api/v1/checkout', async (req, res) => {
  const startTime = process.hrtime();
  const { customerId, items, totalAmount, currency = 'USD', paymentMethod } = req.body;

  // Basic validation of ingress request
  if (!items || !Array.isArray(items) || items.length === 0 || totalAmount === undefined || totalAmount <= 0) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    gatewayRequestsTotal.inc({ route: '/api/v1/checkout', method: 'POST', status_code: '400' });
    gatewayFailureTotal.inc({ reason: 'invalid_payload' });
    gatewayRequestDurationSeconds.observe({ route: '/api/v1/checkout', status_code: '400' }, duration);

    logger.warn('Checkout request rejected: Invalid payload', { customerId, totalAmount, items });
    return res.status(400).json({
      success: false,
      error: 'Invalid checkout request. Array of items and positive numeric totalAmount are required.',
      statusCode: 400
    });
  }

  // Step 1: Optional / Configured Auth Service verification
  if (authServiceUrl) {
    try {
      const authHeader = req.headers.authorization || '';
      await axios.post(
        `${authServiceUrl}/api/verify`,
        { customerId, authHeader },
        { timeout: downstreamTimeoutMs }
      );
    } catch (authErr) {
      const elapsed = process.hrtime(startTime);
      const duration = elapsed[0] + elapsed[1] / 1e9;

      if (authErr.response && (authErr.response.status === 401 || authErr.response.status === 403)) {
        gatewayRequestsTotal.inc({ route: '/api/v1/checkout', method: 'POST', status_code: '401' });
        gatewayFailureTotal.inc({ reason: 'unauthorized' });
        gatewayRequestDurationSeconds.observe({ route: '/api/v1/checkout', status_code: '401' }, duration);

        logger.warn('Auth verification failed', { customerId, status: authErr.response.status });
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Authentication credentials rejected by Auth Service.',
          statusCode: 401
        });
      }

      gatewayUpstreamErrorsTotal.inc({ target_service: 'auth-service', error_type: authErr.code || 'error' });
      gatewayFailureTotal.inc({ reason: 'auth_service_unreachable' });
      gatewayRequestsTotal.inc({ route: '/api/v1/checkout', method: 'POST', status_code: '502' });
      gatewayRequestDurationSeconds.observe({ route: '/api/v1/checkout', status_code: '502' }, duration);

      logger.error('Failed to communicate with Auth Service', { error: authErr.message });
      return res.status(502).json({
        success: false,
        error: 'Bad Gateway: Auth Service dependency failed or timed out.',
        statusCode: 502
      });
    }
  }

  // Step 2: Forward Checkout payload to Order Service
  try {
    const orderPayload = {
      customerId: customerId || 'anonymous_guest',
      items,
      totalAmount,
      currency,
      paymentMethod: paymentMethod || 'credit_card',
      requestedAt: new Date().toISOString()
    };

    logger.info('Forwarding checkout request to Order Service', {
      orderServiceUrl,
      customerId: orderPayload.customerId,
      itemCount: items.length,
      totalAmount
    });

    const orderResponse = await axios.post(`${orderServiceUrl}/api/orders`, orderPayload, {
      timeout: downstreamTimeoutMs
    });

    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    gatewayRequestsTotal.inc({ route: '/api/v1/checkout', method: 'POST', status_code: '200' });
    gatewaySuccessTotal.inc();
    gatewayRequestDurationSeconds.observe({ route: '/api/v1/checkout', status_code: '200' }, duration);

    logger.info('Checkout completed successfully', {
      orderId: orderResponse.data?.orderId || orderResponse.data?.id,
      durationSeconds: duration
    });

    return res.status(200).json({
      success: true,
      message: 'Checkout processed successfully by cluster.',
      order: orderResponse.data
    });
  } catch (err) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    // Resilient Error Propagation: Handle downstream failures without crashing
    if (err.response) {
      // Downstream Order Service responded with an HTTP error status (e.g. 500, 502, 503, 504)
      const downstreamStatus = err.response.status;
      const gatewayStatus = downstreamStatus >= 500 ? 502 : downstreamStatus;

      gatewayRequestsTotal.inc({
        route: '/api/v1/checkout',
        method: 'POST',
        status_code: String(gatewayStatus)
      });
      gatewayFailureTotal.inc({ reason: `downstream_http_${downstreamStatus}` });
      gatewayUpstreamErrorsTotal.inc({
        target_service: 'order-service',
        error_type: `http_${downstreamStatus}`
      });
      gatewayCheckoutErrorsTotal.inc();
      gatewayRequestDurationSeconds.observe(
        { route: '/api/v1/checkout', status_code: String(gatewayStatus) },
        duration
      );

      logger.error('Downstream Order Service returned failure', {
        downstreamStatus,
        gatewayStatus,
        error: err.response.data?.error || err.message,
        durationSeconds: duration
      });

      return res.status(gatewayStatus).json({
        success: false,
        error: `Bad Gateway: Downstream order processing failed (HTTP ${downstreamStatus})`,
        downstreamStatus,
        details: err.response.data?.error || 'Order Service encountered an internal or dependency error.',
        statusCode: gatewayStatus,
        timestamp: new Date().toISOString()
      });
    }

    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      // Downstream request timeout
      gatewayRequestsTotal.inc({ route: '/api/v1/checkout', method: 'POST', status_code: '504' });
      gatewayFailureTotal.inc({ reason: 'downstream_timeout' });
      gatewayUpstreamErrorsTotal.inc({ target_service: 'order-service', error_type: 'timeout' });
      gatewayCheckoutErrorsTotal.inc();
      gatewayRequestDurationSeconds.observe({ route: '/api/v1/checkout', status_code: '504' }, duration);

      logger.error('Downstream Order Service request timed out', {
        orderServiceUrl,
        timeoutMs: downstreamTimeoutMs,
        durationSeconds: duration
      });

      return res.status(504).json({
        success: false,
        error: `Gateway Timeout: Order Service at ${orderServiceUrl} failed to respond within ${downstreamTimeoutMs}ms.`,
        statusCode: 504,
        timestamp: new Date().toISOString()
      });
    }

    // Network / Socket Connection Refused / Unreachable
    gatewayRequestsTotal.inc({ route: '/api/v1/checkout', method: 'POST', status_code: '502' });
    gatewayFailureTotal.inc({ reason: 'downstream_unreachable' });
    gatewayUpstreamErrorsTotal.inc({
      target_service: 'order-service',
      error_type: err.code || 'connection_failure'
    });
    gatewayCheckoutErrorsTotal.inc();
    gatewayRequestDurationSeconds.observe({ route: '/api/v1/checkout', status_code: '502' }, duration);

    logger.error('Downstream Order Service unreachable', {
      orderServiceUrl,
      errorCode: err.code,
      message: err.message
    });

    return res.status(502).json({
      success: false,
      error: `Bad Gateway: Unable to reach downstream Order Service at ${orderServiceUrl}.`,
      errorCode: err.code || 'ECONNREFUSED',
      statusCode: 502,
      timestamp: new Date().toISOString()
    });
  }
});

// Startup & Graceful Shutdown
const server = app.listen(port, () => {
  logger.info('API Gateway started successfully', {
    port: Number(port),
    env: process.env.NODE_ENV || 'development',
    orderServiceUrl,
    authServiceUrl: authServiceUrl || 'none (bypass)',
    pid: process.pid
  });
});

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`, { inFlightRequests });
  server.close(() => {
    logger.info('API Gateway HTTP server closed. Process exiting cleanly.');
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
