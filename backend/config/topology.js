// Microservice Dependency Topology & Architectural Metadata
// Represents the SPPU Final Year Project distributed microservices architecture:
// Client -> Gateway (4000) -> Order Service (4001) -> Payment Service (4002) -> MongoDB (27017)

const dependencyTopology = {
  nodes: [
    {
      id: 'frontend',
      name: 'Client / Web Frontend',
      type: 'client',
      port: 5173,
      healthUrl: null,
      criticality: 'High',
      team: 'Frontend Platform'
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
      downstream: ['order-service']
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
      downstream: ['payment-service']
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
    { id: 'e-client-gw', source: 'frontend', target: 'gateway-service', label: 'HTTP / Checkout' },
    { id: 'e-gw-order', source: 'gateway-service', target: 'order-service', label: 'gRPC / REST Orders' },
    { id: 'e-order-payment', source: 'order-service', target: 'payment-service', label: 'REST Payments' },
    { id: 'e-payment-db', source: 'payment-service', target: 'database', label: 'Mongo Connection Pool' }
  ],
  // Pre-computed upstream and downstream dependency lookups
  dependencyChains: {
    'database': { downstream: [], upstream: ['payment-service', 'order-service', 'gateway-service', 'frontend'] },
    'payment-service': { downstream: ['database'], upstream: ['order-service', 'gateway-service', 'frontend'] },
    'order-service': { downstream: ['payment-service', 'database'], upstream: ['gateway-service', 'frontend'] },
    'gateway-service': { downstream: ['order-service', 'payment-service', 'database'], upstream: ['frontend'] },
    'frontend': { downstream: ['gateway-service', 'order-service', 'payment-service', 'database'], upstream: [] }
  }
};

module.exports = dependencyTopology;
