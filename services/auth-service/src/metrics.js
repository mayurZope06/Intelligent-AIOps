const client = require('prom-client');

// Dedicated registry for Auth Service
const register = new client.Registry();

// Default Node.js runtime process metrics
client.collectDefaultMetrics({
  register,
  prefix: 'nodejs_'
});

// Custom Auth Service metrics
const authRequestsTotal = new client.Counter({
  name: 'auth_requests_total',
  help: 'Total number of authentication and verification requests',
  labelNames: ['route', 'method', 'status_code'],
  registers: [register]
});

const authSuccessTotal = new client.Counter({
  name: 'auth_success_total',
  help: 'Total number of successfully authenticated requests',
  registers: [register]
});

const authFailureTotal = new client.Counter({
  name: 'auth_failure_total',
  help: 'Total number of failed authentication requests',
  labelNames: ['reason'],
  registers: [register]
});

const authRequestDurationSeconds = new client.Histogram({
  name: 'auth_request_duration_seconds',
  help: 'Latency of auth operations in seconds',
  labelNames: ['route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [register]
});

const authFailureMode = new client.Gauge({
  name: 'auth_failure_mode',
  help: 'Active failure simulation mode for Auth Service (1 = active, 0 = inactive)',
  labelNames: ['mode'],
  registers: [register]
});

module.exports = {
  register,
  authRequestsTotal,
  authSuccessTotal,
  authFailureTotal,
  authFailureMode,
  authRequestDurationSeconds
};
