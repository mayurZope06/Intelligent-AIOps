const express = require('express');
const logger = require('./logger');
const {
  register,
  inventoryRequestsTotal,
  inventoryReservationsTotal,
  inventoryReleasesTotal,
  inventoryFailuresTotal,
  inventoryFailureMode,
  inventoryRequestDurationSeconds,
  inventoryAvailableQuantity
} = require('./metrics');

const app = express();
const port = process.env.PORT || 4004;

app.use(express.json());

// Failure simulation state
const failureState = {
  active: false,
  mode: 'none',
  since: null
};

// In-memory inventory store initialized with realistic catalog items
const inventoryStore = {
  'product-1': {
    productId: 'product-1',
    name: 'High-Performance Cloud Compute Node',
    availableQuantity: 10,
    reservedQuantity: 0
  },
  'product-2': {
    productId: 'product-2',
    name: 'Observability Telemetry Sensor',
    availableQuantity: 50,
    reservedQuantity: 0
  },
  'product-3': {
    productId: 'product-3',
    name: 'Edge API Gateway Appliance',
    availableQuantity: 25,
    reservedQuantity: 0
  }
};

// Initialize Prometheus gauges with actual catalog stock
Object.values(inventoryStore).forEach(item => {
  inventoryAvailableQuantity.set({ product_id: item.productId }, item.availableQuantity);
});

// 1. Health Endpoint
app.get('/health', (req, res) => {
  const isHealthy = !failureState.active;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    service: 'inventory-service',
    port: Number(port),
    failureMode: failureState.mode,
    totalSkus: Object.keys(inventoryStore).length,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Controlled Failure Simulation Endpoint
app.post('/api/simulate-failure', (req, res) => {
  const { mode = 'inventory_lock', fail = true } = req.body;

  if (!fail || mode === 'none' || mode === 'reset') {
    const prev = failureState.mode;
    failureState.active = false;
    failureState.mode = 'none';
    failureState.since = null;
    inventoryFailureMode.reset();

    // Restore catalog stock
    inventoryStore['product-1'].availableQuantity = 10;
    inventoryStore['product-2'].availableQuantity = 50;
    inventoryStore['product-3'].availableQuantity = 25;
    Object.values(inventoryStore).forEach(item => {
      inventoryAvailableQuantity.set({ product_id: item.productId }, item.availableQuantity);
    });
    inventoryFailuresTotal.reset();

    logger.info('Inventory failure simulation cleared. Service healthy.', { prev });
    return res.json({
      success: true,
      message: 'Inventory failure simulation cleared. Stock catalog restored.',
      failureMode: 'none',
      status: 'HEALTHY'
    });
  }

  failureState.active = true;
  failureState.mode = mode;
  failureState.since = new Date().toISOString();
  inventoryFailureMode.set({ mode }, 1);

  // Deplete stock to trigger genuine Prometheus anomaly
  Object.values(inventoryStore).forEach(item => {
    item.availableQuantity = 0;
    inventoryAvailableQuantity.set({ product_id: item.productId }, 0);
  });
  inventoryFailuresTotal.inc({ reason: 'inventory_deadlock', product_id: 'product-1' }, 10);

  logger.error('Inventory failure simulation activated', { mode });
  return res.json({
    success: true,
    message: `Inventory failure simulation activated: ${mode}`,
    failureMode: mode,
    status: 'DEGRADED'
  });
});

// 3. Remediation Endpoint
app.post('/api/remediate', (req, res) => {
  const { action = 'replenish_stock', operator = 'AIOps Automation' } = req.body;
  const prevMode = failureState.mode;

  failureState.active = false;
  failureState.mode = 'none';
  failureState.since = null;
  inventoryFailureMode.reset();

  // Replenish stock to healthy baseline
  inventoryStore['product-1'].availableQuantity = 20;
  inventoryStore['product-1'].reservedQuantity = 0;
  inventoryStore['product-2'].availableQuantity = 50;
  inventoryStore['product-2'].reservedQuantity = 0;
  inventoryStore['product-3'].availableQuantity = 30;
  inventoryStore['product-3'].reservedQuantity = 0;
  Object.values(inventoryStore).forEach(item => {
    inventoryAvailableQuantity.set({ product_id: item.productId }, item.availableQuantity);
  });
  inventoryFailuresTotal.reset();

  logger.info(`Inventory Service remediated via ${action} by ${operator}`, { previousMode: prevMode });
  return res.json({
    success: true,
    message: 'Inventory SKU stock replenished and allocation locks released. Telemetry restored.',
    action,
    operator,
    status: 'HEALTHY'
  });
});

// 4. Metrics Endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    logger.error('Failed to export metrics', { error: err.message });
    res.status(500).end(err.message);
  }
});

// 3. Get Stock for Product
app.get('/api/inventory/:productId', (req, res) => {
  const startTime = process.hrtime();
  const { productId } = req.params;
  const product = inventoryStore[productId];

  if (!product) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/:productId', method: 'GET', status_code: '404' });
    inventoryFailuresTotal.inc({ reason: 'product_not_found', product_id: productId });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/:productId', status_code: '404' }, duration);

    logger.warn('Product not found in inventory', { productId });
    return res.status(404).json({
      success: false,
      error: `Product '${productId}' not found in inventory catalog.`,
      productId,
      statusCode: 404
    });
  }

  const elapsed = process.hrtime(startTime);
  const duration = elapsed[0] + elapsed[1] / 1e9;
  inventoryRequestsTotal.inc({ route: '/api/inventory/:productId', method: 'GET', status_code: '200' });
  inventoryRequestDurationSeconds.observe({ route: '/api/inventory/:productId', status_code: '200' }, duration);

  return res.status(200).json({
    success: true,
    productId: product.productId,
    name: product.name,
    availableQuantity: product.availableQuantity,
    reservedQuantity: product.reservedQuantity,
    totalStock: product.availableQuantity + product.reservedQuantity
  });
});

// 4. Reserve Inventory
app.post('/api/inventory/reserve', (req, res) => {
  const startTime = process.hrtime();
  const { productId, quantity } = req.body;

  // Active Failure Mode Execution (Real Inventory Deadlock & Stock Depletion)
  if (failureState.active) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;

    inventoryRequestsTotal.inc({ route: '/api/inventory/reserve', method: 'POST', status_code: '503' });
    inventoryFailuresTotal.inc({ reason: 'inventory_deadlock', product_id: productId || 'catalog' });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/reserve', status_code: '503' }, duration);

    logger.error('Reserve inventory failed: Deadlock and stock depletion active', {
      failureMode: failureState.mode,
      productId,
      quantity
    });

    return res.status(503).json({
      success: false,
      error: 'InventoryDeadlockException: Database lock contention and allocation deadlock. Stock depleted.',
      statusCode: 503,
      failureMode: failureState.mode
    });
  }

  // Validation: non-empty productId and positive integer quantity
  if (!productId || typeof productId !== 'string' || quantity === undefined || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/reserve', method: 'POST', status_code: '400' });
    inventoryFailuresTotal.inc({ reason: 'invalid_reserve_payload', product_id: productId || 'unknown' });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/reserve', status_code: '400' }, duration);

    logger.warn('Reserve inventory rejected: Invalid payload', { productId, quantity });
    return res.status(400).json({
      success: false,
      error: 'Invalid request. Valid string productId and positive integer quantity are required.',
      statusCode: 400
    });
  }

  const product = inventoryStore[productId];
  if (!product) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/reserve', method: 'POST', status_code: '404' });
    inventoryFailuresTotal.inc({ reason: 'product_not_found', product_id: productId });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/reserve', status_code: '404' }, duration);

    logger.warn('Reserve inventory rejected: Product not found', { productId });
    return res.status(404).json({
      success: false,
      error: `Product '${productId}' not found in inventory catalog.`,
      productId,
      statusCode: 404
    });
  }

  // Check available stock
  if (product.availableQuantity < quantity) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/reserve', method: 'POST', status_code: '409' });
    inventoryFailuresTotal.inc({ reason: 'insufficient_inventory', product_id: productId });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/reserve', status_code: '409' }, duration);

    logger.warn('Reserve inventory failed: Insufficient stock', {
      productId,
      requestedQuantity: quantity,
      availableQuantity: product.availableQuantity
    });

    return res.status(409).json({
      success: false,
      error: `Insufficient inventory for product '${productId}'. Requested: ${quantity}, Available: ${product.availableQuantity}.`,
      productId,
      requestedQuantity: quantity,
      availableQuantity: product.availableQuantity,
      statusCode: 409
    });
  }

  // Execute reservation and update actual state
  product.availableQuantity -= quantity;
  product.reservedQuantity += quantity;

  // Synchronize actual gauge and counters
  inventoryAvailableQuantity.set({ product_id: productId }, product.availableQuantity);
  inventoryReservationsTotal.inc({ product_id: productId }, quantity);

  const elapsed = process.hrtime(startTime);
  const duration = elapsed[0] + elapsed[1] / 1e9;
  inventoryRequestsTotal.inc({ route: '/api/inventory/reserve', method: 'POST', status_code: '200' });
  inventoryRequestDurationSeconds.observe({ route: '/api/inventory/reserve', status_code: '200' }, duration);

  logger.info('Inventory successfully reserved', {
    productId,
    quantity,
    newAvailable: product.availableQuantity,
    newReserved: product.reservedQuantity,
    durationSeconds: duration
  });

  return res.status(200).json({
    success: true,
    message: 'Inventory successfully reserved.',
    productId,
    reservedQuantity: quantity,
    availableQuantity: product.availableQuantity,
    totalReserved: product.reservedQuantity,
    timestamp: new Date().toISOString()
  });
});

// 5. Release Reserved Inventory
app.post('/api/inventory/release', (req, res) => {
  const startTime = process.hrtime();
  const { productId, quantity } = req.body;

  // Validation: non-empty productId and positive integer quantity
  if (!productId || typeof productId !== 'string' || quantity === undefined || typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/release', method: 'POST', status_code: '400' });
    inventoryFailuresTotal.inc({ reason: 'invalid_release_payload', product_id: productId || 'unknown' });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/release', status_code: '400' }, duration);

    logger.warn('Release inventory rejected: Invalid payload', { productId, quantity });
    return res.status(400).json({
      success: false,
      error: 'Invalid request. Valid string productId and positive integer quantity are required.',
      statusCode: 400
    });
  }

  const product = inventoryStore[productId];
  if (!product) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/release', method: 'POST', status_code: '404' });
    inventoryFailuresTotal.inc({ reason: 'product_not_found', product_id: productId });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/release', status_code: '404' }, duration);

    logger.warn('Release inventory rejected: Product not found', { productId });
    return res.status(404).json({
      success: false,
      error: `Product '${productId}' not found in inventory catalog.`,
      productId,
      statusCode: 404
    });
  }

  // Validate that release does not exceed currently reserved amount
  if (product.reservedQuantity < quantity) {
    const elapsed = process.hrtime(startTime);
    const duration = elapsed[0] + elapsed[1] / 1e9;
    inventoryRequestsTotal.inc({ route: '/api/inventory/release', method: 'POST', status_code: '400' });
    inventoryFailuresTotal.inc({ reason: 'excessive_release_quantity', product_id: productId });
    inventoryRequestDurationSeconds.observe({ route: '/api/inventory/release', status_code: '400' }, duration);

    logger.warn('Release inventory rejected: Quantity exceeds reserved pool', {
      productId,
      requestedRelease: quantity,
      currentReserved: product.reservedQuantity
    });

    return res.status(400).json({
      success: false,
      error: `Cannot release ${quantity} units. Only ${product.reservedQuantity} units are currently reserved for product '${productId}'.`,
      productId,
      requestedRelease: quantity,
      currentReserved: product.reservedQuantity,
      statusCode: 400
    });
  }

  // Execute release and restore available stock
  product.reservedQuantity -= quantity;
  product.availableQuantity += quantity;

  // Synchronize actual gauge and counters
  inventoryAvailableQuantity.set({ product_id: productId }, product.availableQuantity);
  inventoryReleasesTotal.inc({ product_id: productId }, quantity);

  const elapsed = process.hrtime(startTime);
  const duration = elapsed[0] + elapsed[1] / 1e9;
  inventoryRequestsTotal.inc({ route: '/api/inventory/release', method: 'POST', status_code: '200' });
  inventoryRequestDurationSeconds.observe({ route: '/api/inventory/release', status_code: '200' }, duration);

  logger.info('Reserved inventory successfully released back to available pool', {
    productId,
    quantity,
    newAvailable: product.availableQuantity,
    newReserved: product.reservedQuantity,
    durationSeconds: duration
  });

  return res.status(200).json({
    success: true,
    message: 'Reserved inventory successfully released back to available stock.',
    productId,
    releasedQuantity: quantity,
    availableQuantity: product.availableQuantity,
    reservedQuantity: product.reservedQuantity,
    timestamp: new Date().toISOString()
  });
});

// Startup & Graceful Shutdown
const server = app.listen(port, () => {
  logger.info('Inventory Service started successfully', {
    port: Number(port),
    env: process.env.NODE_ENV || 'development',
    catalogSkus: Object.keys(inventoryStore).length,
    pid: process.pid
  });
});

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    logger.info('Inventory Service HTTP server closed. Process exiting cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded. Forcing termination.');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server, inventoryStore };
