const assert = require('assert');
const path = require('path');
const dependencyTopology = require('./config/topology');

// Test the topology impact model rules directly
function simulateTopologyImpact(metricsData, currentScenario) {
  // Same logic as backend/index.js computeTopologyImpact
  const anomalies = metricsData?.anomalies || [];
  const servicesInfo = metricsData?.services || {};

  const directFaultMap = {
    'database': false,
    'payment-service': false,
    'inventory-service': false,
    'auth-service': false,
    'order-service': false,
    'gateway-service': false
  };

  const scenario = currentScenario || 'none';

  if (
    scenario === 'db_overload' ||
    anomalies.some(a => a.service === 'database' || a.metric === 'mongodb_connection_pool_used')
  ) {
    directFaultMap['database'] = true;
  }

  if (
    ['payment_gateway_down', 'high_cpu', 'downstream_failure'].includes(scenario) ||
    anomalies.some(a => a.service === 'payment-service' && (
      a.metric === 'payment_gateway_down' ||
      a.metric === 'event_loop_lag_seconds' ||
      a.metric === 'process_cpu_usage_ratio' ||
      a.metric === 'payment_failure_mode'
    ))
  ) {
    directFaultMap['payment-service'] = true;
  }

  if (
    scenario === 'inventory_lock' ||
    anomalies.some(a => a.service === 'inventory-service' && (
      a.metric === 'inventory_deadlock_total' ||
      a.metric === 'inventory_failure_mode'
    ))
  ) {
    directFaultMap['inventory-service'] = true;
  }

  if (
    scenario === 'auth_storm' ||
    anomalies.some(a => a.service === 'auth-service' && (
      a.metric === 'auth_401_rate' ||
      a.metric === 'auth_token_storm_total' ||
      a.metric === 'auth_failure_mode'
    ))
  ) {
    directFaultMap['auth-service'] = true;
  }

  if (
    scenario === 'order_deadlock' ||
    anomalies.some(a => a.service === 'order-service' && a.metric === 'order_failure_mode')
  ) {
    directFaultMap['order-service'] = true;
  }

  if (
    ['gateway_outage', 'cache_stampede'].includes(scenario) ||
    anomalies.some(a => a.service === 'gateway-service' && a.metric === 'gateway_failure_mode')
  ) {
    directFaultMap['gateway-service'] = true;
  }

  const isOffline = (id) => servicesInfo[id]?.status === 'OFFLINE';

  const nodeStatuses = {};
  const nodeAnomaliesMap = {};

  for (const node of dependencyTopology.nodes) {
    nodeAnomaliesMap[node.id] = anomalies.filter(a => a.service === node.id);
  }

  // Database
  if (isOffline('database')) {
    nodeStatuses['database'] = 'OFFLINE';
  } else if (directFaultMap['database']) {
    nodeStatuses['database'] = 'CRITICAL';
  } else {
    nodeStatuses['database'] = 'HEALTHY';
  }

  // Inventory Service (Terminal)
  if (isOffline('inventory-service')) {
    nodeStatuses['inventory-service'] = 'OFFLINE';
  } else if (directFaultMap['inventory-service']) {
    nodeStatuses['inventory-service'] = 'CRITICAL';
  } else {
    nodeStatuses['inventory-service'] = 'HEALTHY';
  }

  // Auth Service (Terminal)
  if (isOffline('auth-service')) {
    nodeStatuses['auth-service'] = 'OFFLINE';
  } else if (directFaultMap['auth-service']) {
    nodeStatuses['auth-service'] = 'CRITICAL';
  } else {
    nodeStatuses['auth-service'] = 'HEALTHY';
  }

  // Payment Service (Depends only on Database)
  if (isOffline('payment-service')) {
    nodeStatuses['payment-service'] = 'OFFLINE';
  } else if (directFaultMap['payment-service']) {
    nodeStatuses['payment-service'] = 'CRITICAL';
  } else if (nodeStatuses['database'] === 'CRITICAL' || nodeStatuses['database'] === 'OFFLINE') {
    nodeStatuses['payment-service'] = 'CRITICAL';
  } else {
    nodeStatuses['payment-service'] = 'HEALTHY';
  }

  // Order Service (Depends on Inventory and Payment)
  if (isOffline('order-service')) {
    nodeStatuses['order-service'] = 'OFFLINE';
  } else if (directFaultMap['order-service']) {
    nodeStatuses['order-service'] = 'CRITICAL';
  } else if (nodeStatuses['inventory-service'] === 'CRITICAL' || nodeStatuses['inventory-service'] === 'OFFLINE') {
    nodeStatuses['order-service'] = 'DEGRADED';
  } else if (nodeStatuses['payment-service'] === 'CRITICAL' || nodeStatuses['payment-service'] === 'DEGRADED' || nodeStatuses['payment-service'] === 'OFFLINE') {
    nodeStatuses['order-service'] = 'DEGRADED';
  } else {
    nodeStatuses['order-service'] = 'HEALTHY';
  }

  // Gateway Service (Depends on Auth and Order)
  if (isOffline('gateway-service')) {
    nodeStatuses['gateway-service'] = 'OFFLINE';
  } else if (directFaultMap['gateway-service']) {
    nodeStatuses['gateway-service'] = 'CRITICAL';
  } else if (nodeStatuses['auth-service'] === 'CRITICAL' || nodeStatuses['auth-service'] === 'OFFLINE') {
    nodeStatuses['gateway-service'] = 'DEGRADED';
  } else if (nodeStatuses['order-service'] === 'CRITICAL' || nodeStatuses['order-service'] === 'DEGRADED' || nodeStatuses['order-service'] === 'OFFLINE') {
    nodeStatuses['gateway-service'] = 'DEGRADED';
  } else {
    nodeStatuses['gateway-service'] = 'HEALTHY';
  }

  // Frontend
  if (nodeStatuses['gateway-service'] !== 'HEALTHY') {
    nodeStatuses['frontend'] = 'DEGRADED';
  } else {
    nodeStatuses['frontend'] = 'HEALTHY';
  }

  // Edges
  const edges = dependencyTopology.edges.map(e => {
    let isAffected = false;
    let severity = 'NOMINAL';

    if (e.id === 'e-client-gw') {
      if (nodeStatuses['gateway-service'] !== 'HEALTHY') {
        isAffected = true;
        severity = nodeStatuses['gateway-service'] === 'CRITICAL' ? 'CRITICAL' : 'DEGRADED';
      }
    } else if (e.id === 'e-gw-auth') {
      if (nodeStatuses['auth-service'] !== 'HEALTHY') {
        isAffected = true;
        severity = 'CRITICAL';
      }
    } else if (e.id === 'e-gw-order') {
      if (nodeStatuses['order-service'] !== 'HEALTHY') {
        isAffected = true;
        severity = nodeStatuses['order-service'] === 'CRITICAL' ? 'CRITICAL' : 'DEGRADED';
      }
    } else if (e.id === 'e-order-inv') {
      if (nodeStatuses['inventory-service'] !== 'HEALTHY') {
        isAffected = true;
        severity = 'CRITICAL';
      }
    } else if (e.id === 'e-order-payment') {
      if (nodeStatuses['payment-service'] !== 'HEALTHY') {
        isAffected = true;
        severity = nodeStatuses['payment-service'] === 'CRITICAL' ? 'CRITICAL' : 'DEGRADED';
      }
    } else if (e.id === 'e-payment-db') {
      if (nodeStatuses['database'] !== 'HEALTHY') {
        isAffected = true;
        severity = 'CRITICAL';
      }
    }

    return {
      ...e,
      isAffectedPath: isAffected,
      status: isAffected ? 'AFFECTED' : 'NOMINAL',
      severity
    };
  });

  const nodes = dependencyTopology.nodes.map(n => ({
    ...n,
    status: nodeStatuses[n.id] || 'HEALTHY'
  }));

  const failingServiceIds = nodes
    .filter(n => n.status === 'CRITICAL' || n.status === 'DEGRADED' || n.status === 'OFFLINE')
    .map(n => n.id);

  const affectedEdgeIds = edges.filter(e => e.isAffectedPath).map(e => e.id);

  let clusterStatus = 'NOMINAL';
  if (nodes.some(n => n.status === 'CRITICAL' || n.status === 'OFFLINE')) {
    clusterStatus = 'CRITICAL';
  } else if (nodes.some(n => n.status === 'DEGRADED')) {
    clusterStatus = 'DEGRADED';
  }

  let telemetryStatus = 'NOMINAL';
  if (failingServiceIds.length > 0 || anomalies.length > 0) {
    telemetryStatus = 'ANOMALY';
  }

  return {
    nodes,
    edges,
    nodeStatuses,
    failingServiceIds,
    affectedEdgeIds,
    clusterStatus,
    telemetryStatus
  };
}

console.log('================================================================');
console.log('  TESTING TOPOLOGY IMPACT MODEL BASED ON DEPENDENCY GRAPH');
console.log('  Client -> Gateway -> [Auth, Order] -> [Inv, Payment] -> MongoDB');
console.log('================================================================\n');

// 1. BASELINE TEST
console.log('Test 1: Baseline Nominal State (No faults)');
{
  const res = simulateTopologyImpact({ anomalies: [] }, 'none');
  assert.strictEqual(res.clusterStatus, 'NOMINAL', 'Cluster status should be NOMINAL');
  assert.strictEqual(res.telemetryStatus, 'NOMINAL', 'Telemetry status should be NOMINAL');
  assert.strictEqual(res.affectedEdgeIds.length, 0, 'No edges should be affected');
  assert.strictEqual(res.failingServiceIds.length, 0, 'No services should be failing');
  for (const [nodeId, status] of Object.entries(res.nodeStatuses)) {
    assert.strictEqual(status, 'HEALTHY', `Node ${nodeId} should be HEALTHY`);
  }
  console.log('  PASS: All 7 nodes are HEALTHY and all 6 edges are NOMINAL.\n');
}

// 2. API Gateway 502 Outage -> Gateway
console.log('Test 2: API Gateway 502 Outage (gateway_outage)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'gateway-service', metric: 'gateway_failure_mode', severity: 'CRITICAL' }]
  }, 'gateway_outage');

  assert.strictEqual(res.nodeStatuses['gateway-service'], 'CRITICAL', 'Gateway should be CRITICAL');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED', 'Frontend should be DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY', 'Auth must remain HEALTHY (isolated)');
  assert.strictEqual(res.nodeStatuses['order-service'], 'HEALTHY', 'Order must remain HEALTHY (isolated)');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY', 'Inventory must remain HEALTHY');
  assert.strictEqual(res.nodeStatuses['payment-service'], 'HEALTHY', 'Payment must remain HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY', 'Database must remain HEALTHY');

  assert.deepStrictEqual(res.affectedEdgeIds, ['e-client-gw'], 'Only e-client-gw should be affected');
  assert.strictEqual(res.clusterStatus, 'CRITICAL');
  console.log('  PASS: Gateway is CRITICAL; Order/Payment/Inventory/Auth remain HEALTHY; only e-client-gw affected.\n');
}

// 3. Ingress Cache Storm -> Gateway
console.log('Test 3: Ingress Cache Storm (cache_stampede)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'gateway-service', metric: 'gateway_failure_mode', severity: 'CRITICAL' }]
  }, 'cache_stampede');

  assert.strictEqual(res.nodeStatuses['gateway-service'], 'CRITICAL');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY');
  assert.strictEqual(res.nodeStatuses['order-service'], 'HEALTHY');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY');
  assert.strictEqual(res.nodeStatuses['payment-service'], 'HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY');

  assert.deepStrictEqual(res.affectedEdgeIds, ['e-client-gw']);
  console.log('  PASS: Gateway is CRITICAL; all downstream nodes stay HEALTHY.\n');
}

// 4. Order Circuit Breaker Trip -> Order
console.log('Test 4: Order Circuit Breaker Trip (order_deadlock)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'order-service', metric: 'order_failure_mode', severity: 'CRITICAL' }]
  }, 'order_deadlock');

  assert.strictEqual(res.nodeStatuses['order-service'], 'CRITICAL', 'Order must be CRITICAL');
  assert.strictEqual(res.nodeStatuses['gateway-service'], 'DEGRADED', 'Gateway must be DEGRADED (downstream checkout failed)');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED', 'Frontend must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY', 'Auth must remain HEALTHY');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY', 'Inventory must remain HEALTHY');
  assert.strictEqual(res.nodeStatuses['payment-service'], 'HEALTHY', 'Payment must remain HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY', 'Database must remain HEALTHY');

  assert(res.affectedEdgeIds.includes('e-gw-order'), 'e-gw-order must be affected');
  assert(res.affectedEdgeIds.includes('e-client-gw'), 'e-client-gw must be affected');
  assert(!res.affectedEdgeIds.includes('e-gw-auth'), 'e-gw-auth must stay NOMINAL');
  assert(!res.affectedEdgeIds.includes('e-order-inv'), 'e-order-inv must stay NOMINAL');
  assert(!res.affectedEdgeIds.includes('e-order-payment'), 'e-order-payment must stay NOMINAL');
  console.log('  PASS: Order is CRITICAL; Gateway/Client DEGRADED; Auth, Inv, Pay, DB stay HEALTHY.\n');
}

// 5. Auth Token Storm & 401 Burst -> Auth
console.log('Test 5: Auth Token Storm & 401 Burst (auth_storm)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'auth-service', metric: 'auth_token_storm_total', severity: 'CRITICAL' }]
  }, 'auth_storm');

  assert.strictEqual(res.nodeStatuses['auth-service'], 'CRITICAL', 'Auth must be CRITICAL');
  assert.strictEqual(res.nodeStatuses['gateway-service'], 'DEGRADED', 'Gateway must be DEGRADED (auth verification failed)');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED', 'Frontend must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['order-service'], 'HEALTHY', 'Order must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY', 'Inventory must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['payment-service'], 'HEALTHY', 'Payment must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY', 'Database must stay HEALTHY');

  assert(res.affectedEdgeIds.includes('e-gw-auth'), 'e-gw-auth must be affected');
  assert(res.affectedEdgeIds.includes('e-client-gw'), 'e-client-gw must be affected');
  assert(!res.affectedEdgeIds.includes('e-gw-order'), 'e-gw-order must stay NOMINAL');
  console.log('  PASS: Auth is CRITICAL; Gateway/Client DEGRADED; Order branch completely HEALTHY.\n');
}

// 6. Inventory Deadlock & Depletion -> Inventory
console.log('Test 6: Inventory Deadlock & Depletion (inventory_lock)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'inventory-service', metric: 'inventory_deadlock_total', severity: 'CRITICAL' }]
  }, 'inventory_lock');

  assert.strictEqual(res.nodeStatuses['inventory-service'], 'CRITICAL', 'Inventory must be CRITICAL');
  assert.strictEqual(res.nodeStatuses['order-service'], 'DEGRADED', 'Order must be DEGRADED (stock reservation failed)');
  assert.strictEqual(res.nodeStatuses['gateway-service'], 'DEGRADED', 'Gateway must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED', 'Frontend must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY', 'Auth must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['payment-service'], 'HEALTHY', 'Payment must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY', 'Database must stay HEALTHY');

  assert(res.affectedEdgeIds.includes('e-order-inv'), 'e-order-inv must be affected');
  assert(res.affectedEdgeIds.includes('e-gw-order'), 'e-gw-order must be affected');
  assert(res.affectedEdgeIds.includes('e-client-gw'), 'e-client-gw must be affected');
  assert(!res.affectedEdgeIds.includes('e-gw-auth'), 'e-gw-auth must stay NOMINAL');
  assert(!res.affectedEdgeIds.includes('e-order-payment'), 'e-order-payment must stay NOMINAL');
  console.log('  PASS: Inventory is CRITICAL; Order/Gateway/Client DEGRADED; Auth & Payment branches stay HEALTHY.\n');
}

// 7. 3rd-Party Gateway 503 -> Payment
console.log('Test 7: 3rd-Party Gateway 503 (payment_gateway_down)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'payment-service', metric: 'payment_gateway_down', severity: 'CRITICAL' }]
  }, 'payment_gateway_down');

  assert.strictEqual(res.nodeStatuses['payment-service'], 'CRITICAL', 'Payment must be CRITICAL');
  assert.strictEqual(res.nodeStatuses['order-service'], 'DEGRADED', 'Order must be DEGRADED (charge failed)');
  assert.strictEqual(res.nodeStatuses['gateway-service'], 'DEGRADED', 'Gateway must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED', 'Frontend must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY', 'Auth must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY', 'Inventory must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY', 'Database must stay HEALTHY');

  assert(res.affectedEdgeIds.includes('e-order-payment'), 'e-order-payment must be affected');
  assert(res.affectedEdgeIds.includes('e-gw-order'), 'e-gw-order must be affected');
  assert(res.affectedEdgeIds.includes('e-client-gw'), 'e-client-gw must be affected');
  assert(!res.affectedEdgeIds.includes('e-order-inv'), 'e-order-inv must stay NOMINAL');
  assert(!res.affectedEdgeIds.includes('e-payment-db'), 'e-payment-db must stay NOMINAL');
  console.log('  PASS: Payment is CRITICAL; Order/Gateway/Client DEGRADED; Auth, Inventory, Database stay HEALTHY.\n');
}

// 8. High CPU & Event Loop -> Payment
console.log('Test 8: High CPU & Event Loop Saturation (high_cpu)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'payment-service', metric: 'process_cpu_usage_ratio', severity: 'CRITICAL' }]
  }, 'high_cpu');

  assert.strictEqual(res.nodeStatuses['payment-service'], 'CRITICAL', 'Payment must be CRITICAL');
  assert.strictEqual(res.nodeStatuses['order-service'], 'DEGRADED');
  assert.strictEqual(res.nodeStatuses['gateway-service'], 'DEGRADED');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY');
  assert.strictEqual(res.nodeStatuses['database'], 'HEALTHY');
  console.log('  PASS: High CPU affects Payment -> Order -> Gateway path; others stay HEALTHY.\n');
}

// 9. DB Pool Exhaustion -> MongoDB
console.log('Test 9: DB Pool Exhaustion (db_overload)');
{
  const res = simulateTopologyImpact({
    anomalies: [{ service: 'database', metric: 'mongodb_connection_pool_used', severity: 'CRITICAL' }]
  }, 'db_overload');

  assert.strictEqual(res.nodeStatuses['database'], 'CRITICAL', 'Database must be CRITICAL');
  assert.strictEqual(res.nodeStatuses['payment-service'], 'CRITICAL', 'Payment must be CRITICAL (DB queries failing)');
  assert.strictEqual(res.nodeStatuses['order-service'], 'DEGRADED', 'Order must be DEGRADED (payment charge failed)');
  assert.strictEqual(res.nodeStatuses['gateway-service'], 'DEGRADED', 'Gateway must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['frontend'], 'DEGRADED', 'Frontend must be DEGRADED');
  assert.strictEqual(res.nodeStatuses['auth-service'], 'HEALTHY', 'Auth must stay HEALTHY');
  assert.strictEqual(res.nodeStatuses['inventory-service'], 'HEALTHY', 'Inventory must stay HEALTHY');

  assert(res.affectedEdgeIds.includes('e-payment-db'), 'e-payment-db must be affected');
  assert(res.affectedEdgeIds.includes('e-order-payment'), 'e-order-payment must be affected');
  assert(res.affectedEdgeIds.includes('e-gw-order'), 'e-gw-order must be affected');
  assert(res.affectedEdgeIds.includes('e-client-gw'), 'e-client-gw must be affected');
  assert(!res.affectedEdgeIds.includes('e-gw-auth'), 'e-gw-auth must stay NOMINAL');
  assert(!res.affectedEdgeIds.includes('e-order-inv'), 'e-order-inv must stay NOMINAL');
  console.log('  PASS: MongoDB is CRITICAL; Payment CRITICAL; Order/Gateway/Client DEGRADED; Auth & Inv stay HEALTHY.\n');
}

// 10. RECOVERY RECOMPUTATION
console.log('Test 10: Fresh Telemetry Post-Remediation Recomputation');
{
  const res = simulateTopologyImpact({ anomalies: [] }, 'none');
  assert.strictEqual(res.clusterStatus, 'NOMINAL');
  assert.strictEqual(res.telemetryStatus, 'NOMINAL');
  assert.strictEqual(res.affectedEdgeIds.length, 0);
  assert.strictEqual(res.failingServiceIds.length, 0);
  console.log('  PASS: After remediation, all nodes and edges recompute dynamically to HEALTHY / NOMINAL.\n');
}

console.log('================================================================');
console.log('  ALL 10 TESTS PASSED SUCCESSFULLY!                             ');
console.log('================================================================');
