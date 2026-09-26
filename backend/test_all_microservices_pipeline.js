const axios = require('axios');
const assert = require('assert');

const API_BASE = 'http://localhost:5000/api';
const GATEWAY_URL = 'http://localhost:4000';
const ORDER_URL = 'http://localhost:4001';
const PAYMENT_URL = 'http://localhost:4002';
const AUTH_URL = 'http://localhost:4003';
const INVENTORY_URL = 'http://localhost:4004';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function resetCluster() {
  await axios.post(`${API_BASE}/scenarios/inject`, { scenario: 'none' }).catch(() => {});
  await sleep(1500);
}

// Helper to run full flow for a specific microservice scenario
async function testMicroserviceScenario({
  name,
  scenario,
  service,
  port,
  probeUrl,
  probePayload,
  expectedFailureCode,
  remediationAction,
  retrySuccessChecker
}) {
  console.log(`\n================================================================`);
  console.log(`  TESTING SCENARIO: ${name} [${scenario}] on ${service}`);
  console.log(`================================================================`);

  // Ensure clean baseline
  await resetCluster();

  // 1. Verify baseline healthy
  const preHealth = await axios.get(`http://localhost:${port}/health`);
  assert.strictEqual(preHealth.status, 200, `${service} should be initially UP`);
  console.log(`  [1/8] Baseline Health Check: ${service} is UP (HTTP 200)`);

  // 2. Inject fault
  console.log(`  [2/8] Injecting fault: ${scenario}...`);
  const injectRes = await axios.post(`${API_BASE}/scenarios/inject`, { scenario });
  assert.strictEqual(injectRes.data.success, true, 'Injection should succeed');
  assert.strictEqual(injectRes.data.verified, true, 'Prometheus should verify anomalous telemetry');
  console.log(`  [2/8] [PASS] Fault injected and verified by Prometheus:`, {
    service: injectRes.data.service,
    anomaly: injectRes.data.anomaly?.metric
  });

  // 3. Verify target microservice is genuinely in failed/degraded state
  console.log(`  [3/8] Verifying target microservice /health & functional endpoints...`);
  const postHealth = await axios.get(`http://localhost:${port}/health`).catch(e => e.response);
  assert.strictEqual(postHealth.status, 503, `${service} /health should return 503 when degraded`);
  console.log(`  [3/8] [PASS] Target /health returned HTTP 503 (Status: ${postHealth.data.status}, Mode: ${postHealth.data.failureMode})`);

  // 4. Verify real functional request fails
  let functionalFailed = false;
  let functionalStatus = 0;
  let functionalData = null;
  try {
    const res = await axios.post(probeUrl, probePayload, { timeout: 3000 });
    functionalStatus = res.status;
    functionalData = res.data;
  } catch (err) {
    if (err.response) {
      functionalFailed = true;
      functionalStatus = err.response.status;
      functionalData = err.response.data;
    } else {
      functionalFailed = true;
      functionalStatus = 0;
    }
  }

  assert.strictEqual(functionalStatus, expectedFailureCode, `Functional probe should return HTTP ${expectedFailureCode}`);
  console.log(`  [4/8] [PASS] Functional call genuinely failed with HTTP ${functionalStatus}:`, functionalData?.error || functionalData?.failureMode || 'Expected failure');

  // 5. Verify incident created from real telemetry
  console.log(`  [5/8] Checking incident creation from real telemetry...`);
  const incidentsRes = await axios.get(`${API_BASE}/incidents`);
  const allIncidents = Array.isArray(incidentsRes.data) ? incidentsRes.data : (incidentsRes.data.incidents || []);
  const openIncidents = allIncidents.filter(i => i.status === 'OPEN');
  assert(openIncidents.length > 0, 'An open incident should exist for active anomaly');
  const incident = openIncidents[0];
  console.log(`  [5/8] [PASS] Incident detected: ID=${incident.id}, Service=${incident.service}, Severity=${incident.severity}`);

  // 6. Invoke Real Gemini RCA
  console.log(`  [6/8] Invoking Google Gemini AI Diagnosis...`);
  const rcaRes = await axios.post(`${API_BASE}/analyze`, {
    incidentId: incident.id
  });

  assert(rcaRes.data.analysis, 'Gemini RCA should return analysis');
  assert.strictEqual(rcaRes.data.analysis.provider, 'Google Gemini LLM');
  console.log(`  [6/8] [PASS] Real Gemini RCA (${rcaRes.data.analysis.model}):`, {
    probableRootCause: rcaRes.data.analysis.probableRootCause.substring(0, 100) + '...',
    confidence: rcaRes.data.analysis.confidence,
    remediationTitle: rcaRes.data.analysis.remediation?.title
  });

  // 7. Human Approval & Real Remediation
  console.log(`  [7/8] Human approval & remediation execution...`);
  const remediateRes = await axios.post(`${API_BASE}/remediation/approve`, {
    incidentId: incident.id,
    service,
    action: remediationAction
  });

  assert.strictEqual(remediateRes.data.success, true);
  assert.strictEqual(remediateRes.data.recovered, true, 'Prometheus should verify service recovery');
  assert.strictEqual(remediateRes.data.verified, true);
  console.log(`  [7/8] [PASS] Remediation verified by Prometheus:`, remediateRes.data.message);

  // 8. Verify service restored to 200 UP and retry functional request
  console.log(`  [8/8] Testing service recovery and retrying functional transaction...`);
  const recoveredHealth = await axios.get(`http://localhost:${port}/health`);
  assert.strictEqual(recoveredHealth.status, 200, `${service} /health must be 200 UP`);

  await retrySuccessChecker();
  console.log(`  [8/8] [PASS] Retried functional transaction succeeded (HTTP 200)!`);

  console.log(`>>> ${name} PIPELINE FULLY VALIDATED!`);
}

async function runAll() {
  console.log('################################################################');
  console.log('   VALIDATING REAL PIPELINE ACROSS ALL 5 MICROSERVICES & DB     ');
  console.log('################################################################');

  // Scenario 1: API Gateway (502 Outage)
  await testMicroserviceScenario({
    name: 'API Gateway 502 Outage',
    scenario: 'gateway_outage',
    service: 'gateway-service',
    port: 4000,
    probeUrl: `${GATEWAY_URL}/api/v1/checkout`,
    probePayload: { customerId: 'cust-gw-test', items: [{ id: 'product-1', quantity: 1 }], totalAmount: 90 },
    expectedFailureCode: 502,
    remediationAction: 'flush_cache',
    retrySuccessChecker: async () => {
      const res = await axios.post(`${GATEWAY_URL}/api/v1/checkout`, {
        customerId: 'cust-gw-retry',
        items: [{ id: 'product-1', quantity: 1 }],
        totalAmount: 90
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    }
  });

  // Scenario 2: Auth Service (Token Storm & 401)
  await testMicroserviceScenario({
    name: 'Auth Token Storm & 401 Burst',
    scenario: 'auth_storm',
    service: 'auth-service',
    port: 4003,
    probeUrl: `${AUTH_URL}/api/verify`,
    probePayload: { customerId: 'cust-auth-test', authHeader: 'Bearer valid_token_test' },
    expectedFailureCode: 401,
    remediationAction: 'flush_cache',
    retrySuccessChecker: async () => {
      const res = await axios.post(`${AUTH_URL}/api/verify`, {
        customerId: 'cust-auth-retry',
        authHeader: 'Bearer valid_token_retry'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.authenticated, true);
    }
  });

  // Scenario 3: Order Service (Circuit Breaker Trip)
  await testMicroserviceScenario({
    name: 'Order Circuit Breaker Trip',
    scenario: 'order_deadlock',
    service: 'order-service',
    port: 4001,
    probeUrl: `${ORDER_URL}/api/orders`,
    probePayload: { customerId: 'cust-ord-test', items: [{ id: 'product-1', quantity: 1 }], totalAmount: 75 },
    expectedFailureCode: 503,
    remediationAction: 'reset_circuit_breaker',
    retrySuccessChecker: async () => {
      const res = await axios.post(`${ORDER_URL}/api/orders`, {
        customerId: 'cust-ord-retry',
        items: [{ id: 'product-1', quantity: 1 }],
        totalAmount: 75
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    }
  });

  // Scenario 4: Inventory Service (Deadlock & Depletion)
  await testMicroserviceScenario({
    name: 'Inventory Deadlock & Stock Depletion',
    scenario: 'inventory_lock',
    service: 'inventory-service',
    port: 4004,
    probeUrl: `${INVENTORY_URL}/api/inventory/reserve`,
    probePayload: { productId: 'product-1', quantity: 1 },
    expectedFailureCode: 503,
    remediationAction: 'replenish_stock',
    retrySuccessChecker: async () => {
      const res = await axios.post(`${INVENTORY_URL}/api/inventory/reserve`, {
        productId: 'product-1',
        quantity: 1
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    }
  });

  // Scenario 5: Payment Service (3rd-Party Gateway 503)
  await testMicroserviceScenario({
    name: 'Payment 3rd-Party Gateway 503',
    scenario: 'payment_gateway_down',
    service: 'payment-service',
    port: 4002,
    probeUrl: `${PAYMENT_URL}/api/charge`,
    probePayload: { orderId: 'ORD-PAY-TEST', amount: 50, currency: 'USD', customerId: 'cust-pay-test' },
    expectedFailureCode: 503,
    remediationAction: 'failover_secondary_gateway',
    retrySuccessChecker: async () => {
      const res = await axios.post(`${PAYMENT_URL}/api/charge`, {
        orderId: 'ORD-PAY-RETRY',
        amount: 50,
        currency: 'USD',
        customerId: 'cust-pay-retry'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    }
  });

  // Final cluster check
  await resetCluster();
  const graph = await axios.get(`${API_BASE}/graph`);
  console.log('\n================================================================');
  console.log('FINAL CLUSTER TOPOLOGY VALIDATION:');
  graph.data.nodes.forEach(n => {
    console.log(`  - ${n.id} (${n.label}): ${n.status}`);
    assert.strictEqual(n.status, 'HEALTHY', `Node ${n.id} must be HEALTHY`);
  });
  console.log('ALL NODES 100% HEALTHY!');
  console.log('################################################################');
  console.log('  ALL MICROSERVICES AND SCENARIOS FULLY VALIDATED AND PASSED!   ');
  console.log('################################################################');
}

runAll().catch(err => {
  console.error('\n[TEST RUNNER FAILED]:', err.response ? err.response.data : err.message);
  process.exit(1);
});
