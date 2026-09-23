// Microservice Dependency Topology & Architectural Metadata
// Represents the SPPU Final Year Project distributed microservices architecture:
// Multi-Tier Architecture: Client -> API Gateway -> [Auth, Order] -> [Redis, Inventory, Payment, Notification] -> [MongoDB, Stripe Gateway]

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
      downstream: ['cache-redis']
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
      downstream: ['inventory-service', 'payment-service', 'notification-service']
    },
    {
      id: 'inventory-service',
      name: 'Inventory & Stock Service',
      type: 'service',
      port: 4004,
      healthUrl: 'http://localhost:4004/health',
      metricsUrl: 'http://localhost:4004/metrics',
      criticality: 'P2-High',
      team: 'Logistics Team',
      downstream: ['database']
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
      downstream: ['database', 'payment-gateway']
    },
    {
      id: 'notification-service',
      name: 'Notification Service',
      type: 'service',
      port: 4005,
      healthUrl: 'http://localhost:4005/health',
      metricsUrl: 'http://localhost:4005/metrics',
      criticality: 'P3-Moderate',
      team: 'Platform Messaging',
      downstream: []
    },
    {
      id: 'cache-redis',
      name: 'Redis Cache Cluster',
      type: 'cache',
      port: 6379,
      healthUrl: null,
      criticality: 'P1-Critical',
      team: 'Infra Ops',
      downstream: []
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
    },
    {
      id: 'payment-gateway',
      name: 'External Payment Gateway',
      type: 'external',
      port: 443,
      healthUrl: null,
      criticality: 'P1-Critical',
      team: 'Third-Party Partner',
      downstream: []
    }
  ],
  edges: [
    { id: 'e-client-gw', source: 'frontend', target: 'gateway-service', label: 'HTTPS / Ingress' },
    { id: 'e-gw-auth', source: 'gateway-service', target: 'auth-service', label: 'gRPC / Auth Verify' },
    { id: 'e-gw-order', source: 'gateway-service', target: 'order-service', label: 'REST / Checkout' },
    { id: 'e-auth-cache', source: 'auth-service', target: 'cache-redis', label: 'Redis Session Cache' },
    { id: 'e-order-inv', source: 'order-service', target: 'inventory-service', label: 'gRPC / Stock Check' },
    { id: 'e-order-payment', source: 'order-service', target: 'payment-service', label: 'REST / Transactions' },
    { id: 'e-order-notif', source: 'order-service', target: 'notification-service', label: 'Async Events / PubSub' },
    { id: 'e-inv-db', source: 'inventory-service', target: 'database', label: 'Mongo Stock Queries' },
    { id: 'e-payment-db', source: 'payment-service', target: 'database', label: 'Mongo Connection Pool' },
    { id: 'e-payment-gw', source: 'payment-service', target: 'payment-gateway', label: 'HTTPS / Stripe API' }
  ],
  // Pre-computed upstream and downstream dependency lookups
  dependencyChains: {
    'payment-gateway': { downstream: [], upstream: ['payment-service', 'order-service', 'gateway-service', 'frontend'] },
    'database': { downstream: [], upstream: ['payment-service', 'inventory-service', 'order-service', 'gateway-service', 'frontend'] },
    'cache-redis': { downstream: [], upstream: ['auth-service', 'gateway-service', 'frontend'] },
    'notification-service': { downstream: [], upstream: ['order-service', 'gateway-service', 'frontend'] },
    'payment-service': { downstream: ['database', 'payment-gateway'], upstream: ['order-service', 'gateway-service', 'frontend'] },
    'inventory-service': { downstream: ['database'], upstream: ['order-service', 'gateway-service', 'frontend'] },
    'auth-service': { downstream: ['cache-redis'], upstream: ['gateway-service', 'frontend'] },
    'order-service': { downstream: ['inventory-service', 'payment-service', 'notification-service', 'database', 'payment-gateway'], upstream: ['gateway-service', 'frontend'] },
    'gateway-service': { downstream: ['auth-service', 'order-service', 'cache-redis', 'inventory-service', 'payment-service', 'notification-service', 'database', 'payment-gateway'], upstream: ['frontend'] },
    'frontend': { downstream: ['gateway-service', 'auth-service', 'order-service'], upstream: [] }
  }
};

module.exports = dependencyTopology;
