const client = require('prom-client');

// Dedicated registry
const register = new client.Registry();

// Default metrics (CPU, memory, event loop lag, file descriptors, etc.)
client.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

// Custom payment service metrics
const paymentRequestsTotal = new client.Counter({
  name: 'payment_requests_total',
  help: 'Total number of payment requests received',
  labelNames: ['route', 'status_code'],
  registers: [register]
});

const paymentSuccessTotal = new client.Counter({
  name: 'payment_success_total',
  help: 'Total number of successfully processed payments',
  registers: [register]
});

const paymentFailureTotal = new client.Counter({
  name: 'payment_failure_total',
  help: 'Total number of failed payment attempts',
  labelNames: ['reason'],
  registers: [register]
});

const paymentRequestDurationSeconds = new client.Histogram({
  name: 'payment_request_duration_seconds',
  help: 'Duration of payment processing requests in seconds',
  labelNames: ['route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

const paymentActiveConnections = new client.Gauge({
  name: 'payment_active_connections',
  help: 'Current active connections or database connection pool utilization',
  registers: [register]
});

const paymentFailureMode = new client.Gauge({
  name: 'payment_failure_mode',
  help: 'Indicates active failure simulation mode (1 if active, 0 if inactive)',
  labelNames: ['mode'],
  registers: [register]
});

// Compatibility counter for backend correlation adapter
const paymentDbErrorsTotal = new client.Counter({
  name: 'payment_db_errors_total',
  help: 'Total database write and connection errors observed',
  registers: [register]
});

// Initialize gauges to default 0
paymentActiveConnections.set(0);
paymentFailureMode.set({ mode: 'none' }, 0);

module.exports = {
  register,
  paymentRequestsTotal,
  paymentSuccessTotal,
  paymentFailureTotal,
  paymentRequestDurationSeconds,
  paymentActiveConnections,
  paymentFailureMode,
  paymentDbErrorsTotal
};
