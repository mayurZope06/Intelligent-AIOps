// Microservice Dependency Topology & Architectural Metadata
// Represents the real core microservices pipeline:
// Client (:5173) -> API Gateway (:4000) -> [Auth (:4003), Order (:4001)] -> [Inventory (:4004), Payment (:4002)] -> MongoDB Cluster (:27017)

const dependencyTopology = {
  nodes: [
    {
      id: 'frontend',
      name: 'Client / Web Frontend',
      type: 'client',
      port: 5173,
      healthUrl: null,
      criticality: 'High',
      team: 'Frontend Platform',
      downstream: ['gateway-service']
    },
    {
      id: 'gateway-service',
      name: 'API Gateway',
      type: 'gateway',
      port: 4000,
      healthUrl: 'http://localhost:4000/health',
      metricsUrl: 'http://localhost:4000/metrics',
      criticality: 'P1-Critical',
      team: 'Core Infrastructure',
      downstream: ['auth-service', 'order-service']
    },
    {
      id: 'auth-service',
      name: 'Auth & IAM Service',
      type: 'service',
      port: 4003,
      healthUrl: 'http://localhost:4003/health',
      metricsUrl: 'http://localhost:4003/metrics',
      criticality: 'P1-Critical',
      team: 'Security & IAM',
      downstream: []
    },
    {
      id: 'order-service',
      name: 'Order Service',
      type: 'service',
      port: 4001,
      healthUrl: 'http://localhost:4001/health',
      metricsUrl: 'http://localhost:4001/metrics',
      criticality: 'P1-Critical',
      team: 'Commerce Team',
      downstream: ['inventory-service', 'payment-service']
    },
    {
      id: 'inventory-service',
      name: 'Inventory Service',
      type: 'service',
      port: 4004,
      healthUrl: 'http://localhost:4004/health',
      metricsUrl: 'http://localhost:4004/metrics',
      criticality: 'P1-Critical',
      team: 'Logistics Team',
      downstream: []
    },
    {
      id: 'payment-service',
      name: 'Payment Service',
      type: 'service',
      port: 4002,
      healthUrl: 'http://localhost:4002/health',
      metricsUrl: 'http://localhost:4002/metrics',
      criticality: 'P1-Critical',
      team: 'Fintech Team',
      downstream: ['database']
    },
    {
      id: 'database',
      name: 'MongoDB Cluster',
      type: 'database',
      port: 27017,
      healthUrl: null,
      criticality: 'P1-Critical',
      team: 'Database Ops',
      downstream: []
    }
  ],
  edges: [
    { id: 'e-client-gw', source: 'frontend', target: 'gateway-service', label: 'HTTPS / Ingress' },
    { id: 'e-gw-auth', source: 'gateway-service', target: 'auth-service', label: 'REST / Verify' },
    { id: 'e-gw-order', source: 'gateway-service', target: 'order-service', label: 'REST / Checkout' },
    { id: 'e-order-inv', source: 'order-service', target: 'inventory-service', label: 'REST / Stock Reserve' },
    { id: 'e-order-payment', source: 'order-service', target: 'payment-service', label: 'REST / Charge' },
    { id: 'e-payment-db', source: 'payment-service', target: 'database', label: 'Mongo Connection Pool' }
  ],
  // Architectural dependency lookups
  dependencyChains: {
    'database': { downstream: [], upstream: ['payment-service', 'order-service', 'gateway-service', 'frontend'] },
    'payment-service': { downstream: ['database'], upstream: ['order-service', 'gateway-service', 'frontend'] },
    'inventory-service': { downstream: [], upstream: ['order-service', 'gateway-service', 'frontend'] },
    'auth-service': { downstream: [], upstream: ['gateway-service', 'frontend'] },
    'order-service': { downstream: ['inventory-service', 'payment-service'], upstream: ['gateway-service', 'frontend'] },
    'gateway-service': { downstream: ['auth-service', 'order-service'], upstream: ['frontend'] },
    'frontend': { downstream: ['gateway-service'], upstream: [] }
  }
};

module.exports = dependencyTopology;


