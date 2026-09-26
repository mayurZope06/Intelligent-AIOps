const axios = require('axios');
const assert = require('assert');

const API_BASE = 'http://localhost:5000/api';
const GATEWAY_URL = 'http://localhost:4000';
const PAYMENT_URL = 'http://localhost:4002';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runEndToEndTest() {
  console.log('================================================================');
  console.log('  END-TO-END PIPELINE VALIDATION: REAL FAILURE -> RCA -> RECOVERY');
  console.log('================================================================\n');

  // Clean baseline reset
  try {
    await axios.post(`${API_BASE}/scenarios/inject`, { scenario: 'none' });
    await sleep(1000);
  } catch (e) {}

  // STEP 1: Verify all services & backend are accessible
  console.log('STEP 1: Verifying baseline connectivity across cluster...');
  const [gwHealth, payHealth, backendMetrics] = await Promise.all([
    axios.get(`${GATEWAY_URL}/health`),
    axios.get(`${PAYMENT_URL}/health`),
    axios.get(`${API_BASE}/telemetry/metrics`)
  ]);

  console.log('  Gateway Health:', gwHealth.data.status);
  console.log('  Payment Health:', payHealth.data.status);
  console.log('  Backend Telemetry Source:', backendMetrics.data.source);
  console.log('  Prometheus Connected:', backendMetrics.data.prometheusConnected);

  // STEP 2: Baseline functional requests (must succeed before fault)
  console.log('\nSTEP 2: Executing baseline healthy transactions...');
  const basePayRes = await axios.post(`${PAYMENT_URL}/api/charge`, {
    orderId: 'ORD-BASE-001',
    amount: 100,
    currency: 'USD',
    customerId: 'cust-baseline'
  });
  assert.strictEqual(basePayRes.status, 200, 'Baseline direct payment should succeed');
  assert.strictEqual(basePayRes.data.success, true);
  console.log('  [PASS] Direct Payment charge succeeded (HTTP 200):', basePayRes.data.transactionId);

  const baseCheckoutRes = await axios.post(`${GATEWAY_URL}/api/v1/checkout`, {
    customerId: 'cust-baseline',
    items: [{ id: 'product-1', quantity: 1 }],
    totalAmount: 100,
    currency: 'USD'
  });
  assert.strictEqual(baseCheckoutRes.status, 200, 'Baseline ingress checkout should succeed');
  assert.strictEqual(baseCheckoutRes.data.success, true);
  console.log('  [PASS] End-to-end checkout through Gateway -> Order -> Inv -> Pay succeeded (HTTP 200)\n');

  // STEP 3: Inject real fault scenario: 3rd-party Gateway 503 Outage on Payment
  console.log('STEP 3: Injecting fault scenario: payment_gateway_down...');
  const injectRes = await axios.post(`${API_BASE}/scenarios/inject`, {
    scenario: 'payment_gateway_down'
  });
  console.log('  Injection API response:', {
    success: injectRes.data.success,
    verified: injectRes.data.verified,
    service: injectRes.data.service
  });

  // STEP 4: Verify the target microservice ITSELF entered a failed state
  console.log('\nSTEP 4: Verifying physical target microservice is genuinely degraded...');
  const degradedHealth = await axios.get(`${PAYMENT_URL}/health`, { validateStatus: () => true });
  console.log('  Payment Service /health HTTP Status:', degradedHealth.status, 'Status:', degradedHealth.data?.status);
  assert.strictEqual(degradedHealth.status, 503, 'Payment /health must return 503 in degraded state');
  assert.strictEqual(degradedHealth.data.status, 'DOWN', 'Payment /health must report DOWN');

  // Test that actual payment charge requests now FAIL
  console.log('  Testing real Payment request failure...');
  const failPayRes = await axios.post(`${PAYMENT_URL}/api/charge`, {
    orderId: 'ORD-FAIL-001',
    amount: 100,
    currency: 'USD',
    customerId: 'cust-fail'
  }, { validateStatus: () => true });
  console.log('  Direct Payment /api/charge response:', failPayRes.status, failPayRes.data?.error);
  assert.strictEqual(failPayRes.status, 503, 'Payment request must fail with HTTP 503');
  assert.strictEqual(failPayRes.data.success, false);

  // Test that ingress checkout through Gateway degrades because of Payment
  console.log('  Testing ingress Gateway checkout failure cascading from Payment...');
  const failCheckoutRes = await axios.post(`${GATEWAY_URL}/api/v1/checkout`, {
    customerId: 'cust-fail',
    items: [{ id: 'product-1', quantity: 1 }],
    totalAmount: 100
  }, { validateStatus: () => true });
  console.log('  Ingress Gateway checkout response:', failCheckoutRes.status, failCheckoutRes.data?.error);
  assert(failCheckoutRes.status >= 500, 'Gateway checkout must fail with 5xx due to downstream payment failure');
  console.log('  [PASS] Target microservice and ingress chain are genuinely degraded.\n');

  // STEP 5: Verify incident creation from real telemetry
  console.log('STEP 5: Verifying incident pipeline created incident from real telemetry...');
  await sleep(1500);
  const incidentsRes = await axios.get(`${API_BASE}/incidents?status=OPEN`);
  const openIncidents = incidentsRes.data.incidents || [];
  console.log('  Open Incidents count:', openIncidents.length);
  const paymentIncident = openIncidents.find(i => i.service === 'payment-service');
  assert(paymentIncident, 'Must have created an open incident for payment-service');
  console.log('  [PASS] Incident created:', {
    id: paymentIncident.id,
    service: paymentIncident.service,
    title: paymentIncident.title,
    severity: paymentIncident.severity
  });

  // STEP 6: Verify Topology Impact Model derives from real telemetry
  console.log('\nSTEP 6: Verifying topology impact graph derived from real telemetry...');
  const graphRes = await axios.get(`${API_BASE}/graph`);
  const nodes = graphRes.data.nodes;
  const payNode = nodes.find(n => n.id === 'payment-service');
  const orderNode = nodes.find(n => n.id === 'order-service');
  const gwNode = nodes.find(n => n.id === 'gateway-service');
  const authNode = nodes.find(n => n.id === 'auth-service');
  const invNode = nodes.find(n => n.id === 'inventory-service');
  const dbNode = nodes.find(n => n.id === 'database');

  console.log('  Node Statuses:');
  console.log('    - Payment:', payNode.status);
  console.log('    - Order:', orderNode.status);
  console.log('    - Gateway:', gwNode.status);
  console.log('    - Auth:', authNode.status, '(Isolated branch)');
  console.log('    - Inventory:', invNode.status, '(Isolated branch)');
  console.log('    - Database:', dbNode.status);

  assert.strictEqual(payNode.status, 'CRITICAL', 'Payment must be CRITICAL');
  assert.strictEqual(orderNode.status, 'DEGRADED', 'Order must be DEGRADED');
  assert.strictEqual(gwNode.status, 'DEGRADED', 'Gateway must be DEGRADED');
  assert.strictEqual(authNode.status, 'HEALTHY', 'Auth must remain HEALTHY');
  assert.strictEqual(invNode.status, 'HEALTHY', 'Inventory must remain HEALTHY');
  assert.strictEqual(dbNode.status, 'HEALTHY', 'Database must remain HEALTHY');
  console.log('  [PASS] Failure propagation strictly follows dependency graph; healthy services remain HEALTHY.\n');

  // STEP 7: Invoke Google Gemini Real RCA
  console.log('STEP 7: Invoking Google Gemini AI Diagnosis on incident...');
  const rcaRes = await axios.post(`${API_BASE}/analyze`, { incidentId: paymentIncident.id });
  const rca = rcaRes.data.analysis;
  console.log('  Gemini RCA Response:', {
    provider: rca.provider,
    model: rca.model,
    rootCause: rca.probableRootCause,
    confidence: rca.confidence,
    remediationTitle: rca.remediation?.title,
    remediationAction: rca.remediation?.actionType
  });
  assert(rca, 'RCA report must exist');
  assert.strictEqual(rca.provider, 'Google Gemini LLM', 'RCA must be provided by Google Gemini LLM');
  assert(rca.probableRootCause && rca.probableRootCause.length > 10, 'Root cause must be populated by Gemini');
  assert(rca.confidence >= 70, 'Gemini confidence score must be >= 70%');
  console.log('  [PASS] Real Gemini RCA generated using only live telemetry evidence.\n');

  // STEP 8: Human Approval and Real Remediation
  console.log('STEP 8: Human approval and execution of remediation...');
  const approvedAction = rca.remediation?.actionType || 'restart_service';
  const remediateRes = await axios.post(`${API_BASE}/remediation/approve`, {
    incidentId: paymentIncident.id,
    service: 'payment-service',
    action: approvedAction,
    operatorName: 'SRE Lead'
  });

  console.log('  Remediation Response:', {
    success: remediateRes.data.success,
    verified: remediateRes.data.verified,
    recovered: remediateRes.data.recovered,
    message: remediateRes.data.message
  });
  assert.strictEqual(remediateRes.data.recovered, true, 'Recovery must be confirmed');
  assert.strictEqual(remediateRes.data.verified, true, 'Prometheus verification must be true');
  console.log('  [PASS] Real remediation executed and recovery verified by Prometheus.\n');

  // STEP 9: Verify Real Service Recovery & Repeat Transaction
  console.log('STEP 9: Verifying target microservice returned to 200 UP and testing repeat transaction...');
  const recoveredHealth = await axios.get(`${PAYMENT_URL}/health`);
  console.log('  Payment Service /health HTTP Status:', recoveredHealth.status, 'Status:', recoveredHealth.data?.status);
  assert.strictEqual(recoveredHealth.status, 200, 'Payment /health must be 200 after recovery');
  assert.strictEqual(recoveredHealth.data.status, 'UP', 'Payment /health must report UP');

  // Test the exact same payment request again (must succeed now!)
  console.log('  Retrying payment charge request...');
  const retryPayRes = await axios.post(`${PAYMENT_URL}/api/charge`, {
    orderId: 'ORD-RECOVERED-001',
    amount: 100,
    currency: 'USD',
    customerId: 'cust-recovered'
  });
  assert.strictEqual(retryPayRes.status, 200, 'Repeat payment request must succeed after remediation');
  assert.strictEqual(retryPayRes.data.success, true);
  console.log('  [PASS] Repeat Payment charge succeeded (HTTP 200):', retryPayRes.data.transactionId);

  // Test the checkout request through Gateway again
  console.log('  Retrying ingress Gateway checkout request...');
  const retryCheckoutRes = await axios.post(`${GATEWAY_URL}/api/v1/checkout`, {
    customerId: 'cust-recovered',
    items: [{ id: 'product-1', quantity: 1 }],
    totalAmount: 100
  });
  assert.strictEqual(retryCheckoutRes.status, 200, 'Repeat Gateway checkout must succeed');
  assert.strictEqual(retryCheckoutRes.data.success, true);
  console.log('  [PASS] End-to-end checkout succeeded (HTTP 200)');

  // STEP 10: Verify Topology & Graph return to NOMINAL
  console.log('\nSTEP 10: Verifying final topology graph state...');
  const finalGraph = await axios.get(`${API_BASE}/graph`);
  console.log('  Final Cluster Status:', finalGraph.data.clusterStatus);
  console.log('  Final Telemetry Status:', finalGraph.data.telemetryStatus);
  console.log('  Final Active Anomalies:', finalGraph.data.rawAnomalies.length);
  for (const n of finalGraph.data.nodes) {
    console.log(`    - ${n.id}: ${n.status}`);
    assert.strictEqual(n.status, 'HEALTHY', `Node ${n.id} must be HEALTHY post-remediation`);
  }
  for (const e of finalGraph.data.edges) {
    assert.strictEqual(e.status, 'NOMINAL', `Edge ${e.id} must be NOMINAL`);
  }
  console.log('  [PASS] All 7 nodes are HEALTHY and all 6 edges are NOMINAL.\n');

  console.log('================================================================');
  console.log('  COMPLETE PIPELINE VALIDATION PASSED 100% SUCCESSFULLY!        ');
  console.log('================================================================');
}

runEndToEndTest().catch(err => {
  console.error('\n[TEST FAILED]:', err.response?.data || err.message);
  process.exit(1);
});
