const express = require('express');
const axios = require('axios');
const logger = require('./logger');
const {
  register,
  orderRequestsTotal,
  orderSuccessTotal,
  orderFailureTotal,
  orderFailureMode,
  orderDownstreamPaymentErrorsTotal,
  orderRequestDurationSeconds
} = require('./metrics');

const app = express();
const port = process.env.PORT || 4001;

// Configurable downstream microservice endpoints
const paymentServiceUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:4002';
const inventoryServiceUrl = process.env.INVENTORY_SERVICE_URL || 'http://localhost:4004';
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
    service: 'order-service',
    port: Number(port),
    failureMode: failureState.mode,
    downstream: {
      paymentService: paymentServiceUrl,
      inventoryService: inventoryServiceUrl
    },
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
  const { mode = 'downstream_failure', fail = true } = req.body;

  if (!fail || mode === 'none' || mode === 'reset') {
    const prev = failureState.mode;
    failureState.active = false;
    failureState.mode = 'none';
    failureState.since = null;
    orderFailureMode.reset();
    orderDownstreamPaymentErrorsTotal.reset();
    orderFailureTotal.reset();

    logger.info('Order failure simulation cleared. Service healthy.', { prev });
    return res.json({
      success: true,
      message: 'Order Service failure cleared. Circuit breaker reset.',
      failureMode: 'none',
      status: 'HEALTHY'
    });
  }

  failureState.active = true;
  failureState.mode = mode;
  failureState.since = new Date().toISOString();
  orderFailureMode.set({ mode }, 1);
  orderDownstreamPaymentErrorsTotal.inc(8);
  orderFailureTotal.inc({ reason: 'circuit_breaker_trip' }, 8);

  logger.error('Order failure simulation activated', { mode });
  return res.json({
    success: true,
    message: `Order Service failure simulated: ${mode}`,
    failureMode: mode,
    status: 'DEGRADED'
  });
});

// 4. Remediation Endpoint
app.post('/api/remediate', (req, res) => {
  const { action = 'reset_circuit_breaker', operator = 'AIOps Automation' } = req.body;
  const prevMode = failureState.mode;

  failureState.active = false;
  failureState.mode = 'none';
  failureState.since = null;

  orderFailureMode.reset();
  orderDownstreamPaymentErrorsTotal.reset();
  orderFailureTotal.reset();

  logger.info(`Order Service remediated via ${action} by ${operator}`, { previousMode: prevMode });
  return res.json({
    success: true,
    message: 'Order Service circuit breaker reset and downstream payment queues cleared.',
    action,
    operator,
    status: 'HEALTHY'
  });
});

// 5. Process Order Workflow
app.post('/api/orders', async (req, res) => {
  const startTime = process.hrtime();
  const { customerId, items, totalAmount, currency = 'USD' } = req.body;

  // Active Failure Mode Execution (Real Order Service Circuit Breaker Failure)
  if (failureState.active) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    orderRequestsTotal.inc({ route: '/api/orders', method: 'POST', status_code: '503' });
    orderFailureTotal.inc({ reason: 'circuit_breaker_open' });
    orderRequestDurationSeconds.observe({ route: '/api/orders', status_code: '503' }, duration);

    logger.error('Order rejected: Circuit breaker open / order deadlock active', {
      failureMode: failureState.mode,
      customerId
    });

    return res.status(503).json({
      success: false,
      error: 'CircuitBreakerOpenException: Order Service circuit breaker is OPEN due to downstream transaction deadlock.',
      statusCode: 503,
      failureMode: failureState.mode
    });
  }

  if (!items || !Array.isArray(items) || items.length === 0 || totalAmount === undefined || totalAmount <= 0) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    orderRequestsTotal.inc({ route: '/api/orders', method: 'POST', status_code: '400' });
    orderFailureTotal.inc({ reason: 'invalid_payload' });
    orderRequestDurationSeconds.observe({ route: '/api/orders', status_code: '400' }, duration);

    logger.warn('Order rejected: Invalid payload', { customerId, totalAmount, items });
    return res.status(400).json({
      success: false,
      error: 'Invalid order request. Non-empty items array and positive totalAmount are required.',
      statusCode: 400
    });
  }

  const orderId = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
  const primaryItem = items[0];
  const productId = primaryItem.id || primaryItem.productId || 'product-1';
  const quantity = primaryItem.qty || primaryItem.quantity || 1;

  let inventoryReserved = false;
  let inventoryResponseData = null;

  // Step 1: Reserve Inventory in Inventory Service
  try {
    logger.info('Reserving inventory with Inventory Service', {
      orderId,
      productId,
      quantity,
      inventoryServiceUrl
    });

    const invRes = await axios.post(
      `${inventoryServiceUrl}/api/inventory/reserve`,
      { productId, quantity },
      { timeout: downstreamTimeoutMs }
    );

    inventoryReserved = true;
    inventoryResponseData = invRes.data;
  } catch (invErr) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    const invStatus = invErr.response?.status || 500;

    orderRequestsTotal.inc({ route: '/api/orders', method: 'POST', status_code: String(invStatus) });
    orderFailureTotal.inc({ reason: 'inventory_reservation_failed' });
    orderRequestDurationSeconds.observe({ route: '/api/orders', status_code: String(invStatus) }, duration);

    logger.error('Inventory reservation failed', {
      orderId,
      status: invStatus,
      error: invErr.response?.data?.error || invErr.message
    });

    return res.status(invStatus).json({
      success: false,
      error: `Order failed: Could not reserve inventory (${invErr.response?.data?.error || invErr.message})`,
      orderId,
      statusCode: invStatus
    });
  }

  // Step 2: Charge Payment in Payment Service
  try {
    logger.info('Authorizing payment with Payment Service', {
      orderId,
      amount: totalAmount,
      paymentServiceUrl
    });

    const paymentRes = await axios.post(
      `${paymentServiceUrl}/api/charge`,
      { orderId, amount: totalAmount, currency, customerId },
      { timeout: downstreamTimeoutMs }
    );

    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    orderRequestsTotal.inc({ route: '/api/orders', method: 'POST', status_code: '200' });
    orderSuccessTotal.inc();
    orderRequestDurationSeconds.observe({ route: '/api/orders', status_code: '200' }, duration);

    logger.info('Order processed and confirmed successfully', {
      orderId,
      transactionId: paymentRes.data?.transactionId,
      durationSeconds: duration
    });

    return res.status(200).json({
      success: true,
      orderId,
      customerId: customerId || 'anonymous_guest',
      totalAmount,
      currency,
      status: 'CONFIRMED',
      payment: paymentRes.data,
      inventory: inventoryResponseData,
      confirmedAt: new Date().toISOString()
    });
  } catch (payErr) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    const payStatus = payErr.response?.status || 500;

    orderDownstreamPaymentErrorsTotal.inc();
    orderRequestsTotal.inc({ route: '/api/orders', method: 'POST', status_code: String(payStatus) });
    orderFailureTotal.inc({ reason: 'payment_charge_failed' });
    orderRequestDurationSeconds.observe({ route: '/api/orders', status_code: String(payStatus) }, duration);

    logger.error('Payment charge failed; executing saga compensation (inventory release)', {
      orderId,
      payStatus,
      error: payErr.response?.data?.error || payErr.message
    });

    // Compensating Transaction (Saga pattern): Release the reserved inventory so stock is not leaked!
    if (inventoryReserved) {
      try {
        await axios.post(
          `${inventoryServiceUrl}/api/inventory/release`,
          { productId, quantity },
          { timeout: downstreamTimeoutMs }
        );
        logger.info('Compensating transaction successful: Inventory released back to stock', { orderId, productId, quantity });
      } catch (releaseErr) {
        logger.error('Failed to release inventory during compensation', { orderId, error: releaseErr.message });
      }
    }

    const payErrorMsg = payErr.response?.data?.error || payErr.message || 'Payment Service connection failure';

    return res.status(payStatus).json({
      success: false,
      error: `Downstream payment failed: ${payErrorMsg}`,
      orderId,
      compensation: 'Inventory reservation released back to catalog.',
      statusCode: payStatus,
      timestamp: new Date().toISOString()
    });
  }
});

// Startup & Graceful Shutdown
const server = app.listen(port, () => {
  logger.info('Order Service started successfully', {
    port: Number(port),
    env: process.env.NODE_ENV || 'development',
    paymentServiceUrl,
    inventoryServiceUrl,
    pid: process.pid
  });
});

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('Order Service HTTP server closed. Process exiting cleanly.');
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
