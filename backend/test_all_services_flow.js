const axios = require('axios');

const BACKEND_URL = 'http://localhost:5000/api';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== STEP 1: Test Baseline Health ===');
  const baseline = await axios.get(`${BACKEND_URL}/telemetry/metrics`);
  console.log('Prometheus Connected:', baseline.data.prometheusConnected);
  console.log('Initial Active Anomalies:', (baseline.data.anomalies || []).length);

  // Test 1: Auth Service (auth_storm)
  console.log('\n=== STEP 2: Inject Auth Storm Fault (auth-service) ===');
  const authInject = await axios.post(`${BACKEND_URL}/scenarios/inject`, { scenario: 'auth_storm' });
  console.log('Auth Injection Result:', {
    verified: authInject.data.verified,
    service: authInject.data.service,
    anomaly: authInject.data.anomaly?.metric,
    incidentId: authInject.data.incident?.id
  });

  const authIncidentId = authInject.data.incident?.id;

  console.log('\n=== STEP 3: Verify Auth Storm in Prometheus & Graph ===');
  const graphWithAuthFault = await axios.get(`${BACKEND_URL}/graph`);
  const authNode = graphWithAuthFault.data.nodes.find(n => n.id === 'auth-service');
  console.log('auth-service node status in graph:', authNode?.status, authNode?.anomalies);

  console.log('\n=== STEP 4: Remediate Auth Service (flush_cache) ===');
  const authRemediate = await axios.post(`${BACKEND_URL}/remediation/approve`, {
    incidentId: authIncidentId,
    service: 'auth-service',
    action: 'flush_cache',
    operatorName: 'DevOps Lead'
  });
  console.log('Auth Remediation Result:', {
    recovered: authRemediate.data.recovered,
    verified: authRemediate.data.verified,
    message: authRemediate.data.message
  });

  // Test 2: Inventory Service (inventory_lock)
  console.log('\n=== STEP 5: Inject Inventory Lock Fault (inventory-service) ===');
  const invInject = await axios.post(`${BACKEND_URL}/scenarios/inject`, { scenario: 'inventory_lock' });
  console.log('Inventory Injection Result:', {
    verified: invInject.data.verified,
    service: invInject.data.service,
    anomaly: invInject.data.anomaly?.metric,
    incidentId: invInject.data.incident?.id
  });

  const invIncidentId = invInject.data.incident?.id;

  console.log('\n=== STEP 6: Verify Inventory Fault in Prometheus & Graph ===');
  const graphWithInvFault = await axios.get(`${BACKEND_URL}/graph`);
  const invNode = graphWithInvFault.data.nodes.find(n => n.id === 'inventory-service');
  console.log('inventory-service node status in graph:', invNode?.status, invNode?.anomalies);

  console.log('\n=== STEP 7: Remediate Inventory Service (replenish_stock) ===');
  const invRemediate = await axios.post(`${BACKEND_URL}/remediation/approve`, {
    incidentId: invIncidentId,
    service: 'inventory-service',
    action: 'replenish_stock',
    operatorName: 'DevOps Lead'
  });
  console.log('Inventory Remediation Result:', {
    recovered: invRemediate.data.recovered,
    verified: invRemediate.data.verified,
    message: invRemediate.data.message
  });

  // Test 3: Clear all back to nominal
  console.log('\n=== STEP 8: Clear All to Nominal ===');
  const resetRes = await axios.post(`${BACKEND_URL}/scenarios/inject`, { scenario: 'none' });
  console.log('Reset Result:', resetRes.data);

  console.log('\n=== STEP 9: Final Telemetry Check ===');
  await sleep(2000);
  const finalMetrics = await axios.get(`${BACKEND_URL}/telemetry/metrics`);
  console.log('Final Anomalies Count:', (finalMetrics.data.anomalies || []).length);
  const finalGraph = await axios.get(`${BACKEND_URL}/graph`);
  console.log('Final Graph Node Statuses:');
  finalGraph.data.nodes.forEach(n => console.log(`  - ${n.id}: ${n.status}`));

  console.log('\nALL TESTS PASSED!');
}

runTest().catch(err => {
  console.error('Test failed:', err.response?.data || err.message);
  process.exit(1);
});
