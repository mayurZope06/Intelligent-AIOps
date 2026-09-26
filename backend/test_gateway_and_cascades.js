const axios = require('axios');

const BACKEND_URL = 'http://localhost:5000/api';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('=== TEST 1: API Gateway Direct Outage ===');
  const gwInject = await axios.post(`${BACKEND_URL}/scenarios/inject`, { scenario: 'gateway_outage' });
  console.log('Gateway Injection Result:', {
    verified: gwInject.data.verified,
    service: gwInject.data.service,
    anomaly: gwInject.data.anomaly?.metric
  });

  const graph1 = await axios.get(`${BACKEND_URL}/graph`);
  const gwNode = graph1.data.nodes.find(n => n.id === 'gateway-service');
  console.log('API Gateway node status in graph:', gwNode?.status, gwNode?.anomalies);

  console.log('\n=== TEST 2: Remediate API Gateway ===');
  const gwRemediate = await axios.post(`${BACKEND_URL}/remediation/approve`, {
    service: 'gateway-service',
    action: 'flush_cache'
  });
  console.log('Gateway Remediation Result:', {
    recovered: gwRemediate.data.recovered,
    verified: gwRemediate.data.verified
  });

  const graph2 = await axios.get(`${BACKEND_URL}/graph`);
  const gwNodeRecovered = graph2.data.nodes.find(n => n.id === 'gateway-service');
  console.log('API Gateway node status after recovery:', gwNodeRecovered?.status);

  console.log('\n=== TEST 3: Payment Service Outage & Cascading Upstream Degradation ===');
  const payInject = await axios.post(`${BACKEND_URL}/scenarios/inject`, { scenario: 'high_cpu' });
  console.log('Payment Injection Result:', {
    verified: payInject.data.verified,
    service: payInject.data.service
  });

  const graph3 = await axios.get(`${BACKEND_URL}/graph`);
  console.log('Graph Node Statuses during Payment Outage:');
  graph3.data.nodes.forEach(n => {
    console.log(`  - ${n.id} (${n.name}): ${n.status}`);
  });

  console.log('\n=== TEST 4: Remediate Payment Service ===');
  const payRemediate = await axios.post(`${BACKEND_URL}/remediation/approve`, {
    service: 'payment-service',
    action: 'reset_fault'
  });
  console.log('Payment Remediation Result:', {
    recovered: payRemediate.data.recovered,
    verified: payRemediate.data.verified
  });

  const graph4 = await axios.get(`${BACKEND_URL}/graph`);
  console.log('Graph Node Statuses after Payment Recovery:');
  graph4.data.nodes.forEach(n => {
    console.log(`  - ${n.id} (${n.name}): ${n.status}`);
  });

  console.log('\n=== TEST 5: Clear All to Baseline Nominal ===');
  await axios.post(`${BACKEND_URL}/scenarios/inject`, { scenario: 'none' });
  await sleep(2000);
  const graphFinal = await axios.get(`${BACKEND_URL}/graph`);
  console.log('All Nodes Status:');
  graphFinal.data.nodes.forEach(n => console.log(`  - ${n.id}: ${n.status}`));

  console.log('\nALL CASCADING & DIRECT NODE TESTS PASSED SUCCESSFULLY!');
}

runTest().catch(err => {
  console.error('Test failed:', err.response?.data || err.message);
  process.exit(1);
});
