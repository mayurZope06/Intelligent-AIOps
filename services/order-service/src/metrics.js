const client = require('prom-client');

// Dedicated registry for Order Service
const register = new client.Registry();

// Default Node.js runtime process metrics
client.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

// Custom Order Service metrics
const orderRequestsTotal = new client.Counter({
  name: 'order_requests_total',
  help: 'Total number of order creation requests received',
  labelNames: ['route', 'method', 'status_code'],
  registers: [register]
});

const orderSuccessTotal = new client.Counter({
  name: 'order_success_total',
  help: 'Total number of orders successfully processed and confirmed',
  registers: [register]
});

const orderFailureTotal = new client.Counter({
  name: 'order_failure_total',
  help: 'Total number of failed order attempts',
  labelNames: ['reason'],
  registers: [register]
});

const orderDownstreamPaymentErrorsTotal = new client.Counter({
  name: 'order_downstream_payment_errors_total',
  help: 'Total number of downstream payment service failures encountered by Order Service',
  registers: [register]
});

const orderRequestDurationSeconds = new client.Histogram({
  name: 'order_request_duration_seconds',
  help: 'Latency of order processing lifecycle in seconds',
  labelNames: ['route', 'status_code'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

const orderFailureMode = new client.Gauge({
  name: 'order_failure_mode',
  help: 'Active failure simulation mode for Order Service (1 = active, 0 = inactive)',
  labelNames: ['mode'],
  registers: [register]
});

module.exports = {
  register,
  orderRequestsTotal,
  orderSuccessTotal,
  orderFailureTotal,
  orderFailureMode,
  orderDownstreamPaymentErrorsTotal,
  orderRequestDurationSeconds
};
