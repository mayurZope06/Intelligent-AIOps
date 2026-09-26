const client = require('prom-client');

// Dedicated registry for Inventory Service
const register = new client.Registry();

// Default Node.js runtime process metrics
client.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

// Custom Inventory Service metrics
const inventoryRequestsTotal = new client.Counter({
  name: 'inventory_requests_total',
  help: 'Total number of HTTP requests received by Inventory Service',
  labelNames: ['route', 'method', 'status_code'],
  registers: [register]
});

const inventoryReservationsTotal = new client.Counter({
  name: 'inventory_reservations_total',
  help: 'Total number of items successfully reserved',
  labelNames: ['product_id'],
  registers: [register]
});

const inventoryReleasesTotal = new client.Counter({
  name: 'inventory_releases_total',
  help: 'Total number of reserved items successfully released back to stock',
  labelNames: ['product_id'],
  registers: [register]
});

const inventoryFailuresTotal = new client.Counter({
  name: 'inventory_failures_total',
  help: 'Total number of inventory operations that failed',
  labelNames: ['reason', 'product_id'],
  registers: [register]
});

const inventoryRequestDurationSeconds = new client.Histogram({
  name: 'inventory_request_duration_seconds',
  help: 'Latency of inventory service operations in seconds',
  labelNames: ['route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register]
});

const inventoryAvailableQuantity = new client.Gauge({
  name: 'inventory_available_quantity',
  help: 'Current actual available quantity of stock for a product',
  labelNames: ['product_id'],
  registers: [register]
});

const inventoryFailureMode = new client.Gauge({
  name: 'inventory_failure_mode',
  help: 'Active failure simulation mode for Inventory Service (1 = active, 0 = inactive)',
  labelNames: ['mode'],
  registers: [register]
});

module.exports = {
  register,
  inventoryRequestsTotal,
  inventoryReservationsTotal,
  inventoryReleasesTotal,
  inventoryFailuresTotal,
  inventoryFailureMode,
  inventoryRequestDurationSeconds,
  inventoryAvailableQuantity
};
