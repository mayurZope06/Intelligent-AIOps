const client = require('prom-client');

// Dedicated registry for API Gateway
const register = new client.Registry();

// Default Node.js runtime process metrics
client.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

// Custom API Gateway metrics
const gatewayRequestsTotal = new client.Counter({
  name: 'gateway_requests_total',
  help: 'Total number of ingress requests received at API Gateway',
  labelNames: ['route', 'method', 'status_code'],
  registers: [register]
});

const gatewaySuccessTotal = new client.Counter({
  name: 'gateway_success_total',
  help: 'Total number of successfully processed ingress requests',
  registers: [register]
});

const gatewayFailureTotal = new client.Counter({
  name: 'gateway_failure_total',
  help: 'Total number of failed gateway requests',
  labelNames: ['reason'],
  registers: [register]
});

const gatewayRequestDurationSeconds = new client.Histogram({
  name: 'gateway_request_duration_seconds',
  help: 'End-to-end request latency observed by the API Gateway in seconds',
  labelNames: ['route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

const gatewayUpstreamErrorsTotal = new client.Counter({
  name: 'gateway_upstream_errors_total',
  help: 'Total downstream/upstream microservice call failures encountered by Gateway',
  labelNames: ['target_service', 'error_type'],
  registers: [register]
});

// Backward-compatibility counter for AIOps core engine correlation
const gatewayCheckoutErrorsTotal = new client.Counter({
  name: 'gateway_checkout_errors_total',
  help: 'Total customer checkout 5xx errors propagated by gateway',
  registers: [register]
});

const gatewayFailureMode = new client.Gauge({
  name: 'gateway_failure_mode',
  help: 'Active failure simulation mode for Gateway Service (1 = active, 0 = inactive)',
  labelNames: ['mode'],
  registers: [register]
});

module.exports = {
  register,
  gatewayRequestsTotal,
  gatewaySuccessTotal,
  gatewayFailureTotal,
  gatewayRequestDurationSeconds,
  gatewayUpstreamErrorsTotal,
  gatewayCheckoutErrorsTotal,
  gatewayFailureMode
};
