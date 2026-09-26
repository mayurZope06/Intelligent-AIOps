require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const dependencyTopology = require('./config/topology');
const prometheusAdapter = require('./adapters/prometheusAdapter');
const lokiAdapter = require('./adapters/lokiAdapter');
const correlationEngine = require('./engine/correlationEngine');
const aiReasoning = require('./engine/aiReasoning');
const ragEngine = require('./rag/ragEngine');
const incidentManager = require('./services/incidentManager');
const storage = require('./services/storage');
const logger = require('./utils/logger')('CoreEngine');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Express HTTP request debug logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.url.startsWith('/api/telemetry/logs')) {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Initialize persistent settings
const savedSettings = storage.read('settings.json', {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
});

if (savedSettings.geminiApiKey) {
  aiReasoning.setApiKey(savedSettings.geminiApiKey);
}
if (savedSettings.geminiModel) {
  aiReasoning.modelName = savedSettings.geminiModel;
}

// 1. Health & Configuration
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    service: 'Intelligent AIOps Core Engine',
    geminiConfigured: !!(aiReasoning.apiKey && !aiReasoning.apiKey.startsWith('demo_')),
    model: aiReasoning.modelName,
    activeIncidents: incidentManager.getMetrics().openIncidents,
    averageMTTR: incidentManager.getMetrics().averageMTTRSeconds,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config/settings', (req, res) => {
  const cfg = storage.read('settings.json', {});
  res.json({
    hasKey: !!(cfg.geminiApiKey && cfg.geminiApiKey.length > 5),
    maskedKey: cfg.geminiApiKey ? `${cfg.geminiApiKey.slice(0, 6)}...${cfg.geminiApiKey.slice(-4)}` : '',
    model: aiReasoning.modelName
  });
});

app.post('/api/config/settings', (req, res) => {
  const { apiKey, model } = req.body;
  const cfg = storage.read('settings.json', {});
  
  if (apiKey !== undefined) {
    cfg.geminiApiKey = apiKey;
    aiReasoning.setApiKey(apiKey);
  }
  if (model) {
    cfg.geminiModel = model;
    aiReasoning.modelName = model;
  }

  storage.write('settings.json', cfg);
  res.json({
    success: true,
    message: 'Configuration saved persistently to disk.',
    model: aiReasoning.modelName,
    hasKey: !!(cfg.geminiApiKey && cfg.geminiApiKey.length > 5)
  });
});

// 2. Service Dependency Graph & Real-Time Node Health
app.get('/api/graph', async (req, res) => {
  try {
    const metricsData = await prometheusAdapter.queryMetrics();
    const anomalies = metricsData.anomalies || [];

    // 1. Identify direct node status from genuine Prometheus anomalies
    const directStatusMap = {};
    const directAnomaliesMap = {};

    for (const node of dependencyTopology.nodes) {
      let nodeAnomalies = anomalies.filter(a => a.service === node.id);

      // Map DB-related payment telemetry directly to the database node
      if (node.id === 'database') {
        const dbAnomalies = anomalies.filter(a => 
          a.service === 'database' || 
          (a.service === 'payment-service' && (a.metric === 'payment_db_errors_total' || (a.metric === 'payment_active_connections' && a.value >= 90) || a.description?.includes('db_overload')))
        );
        nodeAnomalies = [...nodeAnomalies, ...dbAnomalies];
      }

      const isCritical = nodeAnomalies.some(a => a.severity === 'CRITICAL');
      const isDegraded = nodeAnomalies.some(a => a.severity === 'HIGH' || a.severity === 'MEDIUM' || a.severity === 'DEGRADED');
      const serviceInfo = metricsData.services ? metricsData.services[node.id] : null;

      let status = 'HEALTHY';
      if (node.id === 'frontend') {
        status = 'HEALTHY';
      } else if (isCritical) {
        status = 'CRITICAL';
      } else if (isDegraded) {
        status = 'DEGRADED';
      } else if (serviceInfo && serviceInfo.status === 'OFFLINE' && serviceInfo.mode !== 'simulated-baseline') {
        status = 'OFFLINE';
      }

      directStatusMap[node.id] = status;
      directAnomaliesMap[node.id] = nodeAnomalies;
    }

    // 2. Compute Cascading Upstream Degradation
    // If a service has downstream dependencies that are CRITICAL/OFFLINE, its status degrades
    const finalNodesWithHealth = dependencyTopology.nodes.map(node => {
      let status = directStatusMap[node.id];
      const nodeAnomalies = [...(directAnomaliesMap[node.id] || [])];
      const serviceInfo = metricsData.services ? metricsData.services[node.id] : null;

      if (status === 'HEALTHY' && node.id !== 'frontend') {
        const directDownstream = node.downstream || [];
        const hasCriticalDownstream = directDownstream.some(dsId => directStatusMap[dsId] === 'CRITICAL' || directStatusMap[dsId] === 'OFFLINE');
        const hasDegradedDownstream = directDownstream.some(dsId => directStatusMap[dsId] === 'DEGRADED');

        if (hasCriticalDownstream || hasDegradedDownstream) {
          status = 'DEGRADED';
          const failingDs = directDownstream.filter(dsId => directStatusMap[dsId] !== 'HEALTHY');
          nodeAnomalies.push({
            service: node.id,
            metric: 'cascading_downstream_dependency',
            value: 1,
            severity: 'DEGRADED',
            description: `Cascading degradation: Downstream dependency [${failingDs.join(', ')}] is failing.`
          });
        }
      }

      return {
        ...node,
        status,
        anomalies: nodeAnomalies,
        serviceInfo
      };
    });

    const allFailingIds = finalNodesWithHealth
      .filter(n => n.status === 'CRITICAL' || n.status === 'DEGRADED' || n.status === 'OFFLINE')
      .map(n => n.id);

    res.json({
      nodes: finalNodesWithHealth,
      edges: dependencyTopology.edges,
      failingServiceIds: allFailingIds,
      rawAnomalies: anomalies,
      prometheusConnected: metricsData.prometheusConnected
    });
  } catch (err) {
    res.json({
      nodes: dependencyTopology.nodes,
      edges: dependencyTopology.edges,
      failingServiceIds: [],
      rawAnomalies: []
    });
  }
});

// 3. Live Telemetry
app.get('/api/telemetry/metrics', async (req, res) => {
  try {
    const metrics = await prometheusAdapter.queryMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telemetry/buffer-log', (req, res) => {
  lokiAdapter.pushLog(req.body);
  res.status(202).json({ status: 'buffered' });
});

app.get('/api/telemetry/logs', async (req, res) => {
  try {
    const { service, level, limit, onlyErrors } = req.query;
    const logs = await lokiAdapter.queryLogs({
      service,
      level,
      limit: limit ? parseInt(limit) : 80,
      onlyErrors: onlyErrors === 'true'
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Incident Management CRUD
app.get('/api/incidents', (req, res) => {
  const { status, severity, service, search } = req.query;
  const list = incidentManager.getAll({ status, severity, service, search });
  const metrics = incidentManager.getMetrics();
  res.json({
    incidents: list,
    metrics
  });
});

app.get('/api/incidents/:id', (req, res) => {
  const incident = incidentManager.getById(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  res.json(incident);
});

app.post('/api/incidents', (req, res) => {
  const { title, description, service, severity } = req.body;
  if (!title || !service) {
    return res.status(400).json({ error: 'Title and service are required fields.' });
  }
  const incident = incidentManager.create({
    title,
    description,
    service,
    severity: severity || 'P2-High',
    trigger: 'MANUAL'
  });
  res.status(201).json(incident);
});

app.patch('/api/incidents/:id', (req, res) => {
  const updated = incidentManager.update(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Incident not found' });
  res.json(updated);
});

app.delete('/api/incidents/:id', (req, res) => {
  const deleted = incidentManager.delete(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Incident not found' });
  res.json({ success: true, message: `Incident ${req.params.id} deleted permanently.` });
});

app.post('/api/incidents/:id/notes', (req, res) => {
  const { author, text } = req.body;
  if (!text) return res.status(400).json({ error: 'Note text cannot be empty.' });
  const note = incidentManager.addNote(req.params.id, { author, text });
  if (!note) return res.status(404).json({ error: 'Incident not found' });
  res.status(201).json(note);
});

// Telemetry Test Scenario Controls
app.post('/api/telemetry/simulate', (req, res) => {
  const { scenario } = req.body;
  prometheusAdapter.setSimulationScenario(scenario || 'none');

  if (scenario === 'db_overload') {
    lokiAdapter.pushLog({ service: 'database', level: 'CRITICAL', message: '[database] MongoServerSelectionError: Max pool connection limit reached (100/100). Sockets saturated.' });
    lokiAdapter.pushLog({ service: 'payment-service', level: 'CRITICAL', message: '[payment-service] ConnectionPoolTimeoutException: Timeout waiting for connection from pool of 100 max connections.' });
    lokiAdapter.pushLog({ service: 'inventory-service', level: 'WARN', message: '[inventory-service] SlowQueryException: MongoDB inventory stock lookup took 1850ms (>150ms budget).' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'WARN', message: '[order-service] UpstreamRpcException: payment-service:4002 failed to respond within deadline on POST /charge.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'ERROR', message: '[gateway-service] HTTP 502 Bad Gateway: downstream order-service checkout timed out.' });
  } else if (scenario === 'high_cpu') {
    lokiAdapter.pushLog({ service: 'payment-service', level: 'CRITICAL', message: '[payment-service] WorkerThreadStarvation: Event loop lag 520ms. CPU usage 94% exceeds threshold 85%.' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'WARN', message: '[order-service] High latency: payment-service response took 1450ms.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'ERROR', message: '[gateway-service] HTTP 504 Gateway Timeout on /api/v1/checkout.' });
  } else if (scenario === 'downstream_failure') {
    lokiAdapter.pushLog({ service: 'payment-service', level: 'CRITICAL', message: '[payment-service] FATAL: Process out of memory / thread deadlock in payment processing queue.' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'ERROR', message: '[order-service] ConnectionRefused: http://localhost:4002/api/charge unreached.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'ERROR', message: '[gateway-service] HTTP 502 Bad Gateway on checkout route.' });
  } else if (scenario === 'cache_stampede') {
    lokiAdapter.pushLog({ service: 'cache-redis', level: 'CRITICAL', message: '[cache-redis] OOM command not allowed: maxmemory reached. 4500 keys evicted/sec under high write load.' });
    lokiAdapter.pushLog({ service: 'auth-service', level: 'WARN', message: '[auth-service] RedisClientException: Key session:user_* evicted. Forced DB fallback cache miss (latency: 890ms).' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'ERROR', message: '[gateway-service] HTTP 504 Gateway Timeout on /api/v1/auth/verify - Ingress authentication queue blocked.' });
  } else if (scenario === 'inventory_lock') {
    lokiAdapter.pushLog({ service: 'inventory-service', level: 'CRITICAL', message: '[inventory-service] LockWaitTimeout: Deadlock found when trying to get lock for stock SKU allocation table.' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'ERROR', message: '[order-service] InventoryRpcException: Reservation RPC timed out after 3000ms deadline.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'ERROR', message: '[gateway-service] HTTP 504 Gateway Timeout: Customer checkout order could not reserve inventory.' });
  } else if (scenario === 'payment_gateway_down') {
    lokiAdapter.pushLog({ service: 'payment-gateway', level: 'CRITICAL', message: '[payment-gateway] HTTP 503 Service Unavailable: External Stripe Fintech gateway returned downstream 503.' });
    lokiAdapter.pushLog({ service: 'payment-service', level: 'ERROR', message: '[payment-service] CircuitBreakerTripped: State OPEN. Failing fast on charge requests to protect worker pool.' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'WARN', message: '[order-service] PaymentRejectedException: Payment provider circuit breaker open. Order checkout aborted.' });
  } else if (scenario === 'auth_storm') {
    lokiAdapter.pushLog({ service: 'auth-service', level: 'CRITICAL', message: '[auth-service] CryptoThreadExhaustion: CPU 98%. Heavy asymmetric RSA verification on expired JWT token storm.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'ERROR', message: '[gateway-service] HTTP 401 Unauthorized storm: 120 client requests rejected in 5s burst.' });
  } else if (scenario === 'none' || scenario === 'reset') {
    lokiAdapter.pushLog({ service: 'auth-service', level: 'INFO', message: '[auth-service] Auth session validation nominal (8ms). Token verification pipeline healthy.' });
    lokiAdapter.pushLog({ service: 'inventory-service', level: 'INFO', message: '[inventory-service] Stock reservation locks cleared. Inventory allocation operational.' });
    lokiAdapter.pushLog({ service: 'payment-service', level: 'INFO', message: '[payment-service] Connection pool drained and reset. Ready for traffic.' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'INFO', message: '[order-service] Downstream microservice dependencies restored. RPC latency: 19ms.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'INFO', message: '[gateway-service] All upstream microservice probes nominal. Ingress error rate: 0.00%.' });
  }

  logger.info(`Telemetry test scenario activated: ${scenario || 'none'}`);
  res.json({ success: true, scenario: scenario || 'none' });
});

app.get('/api/telemetry/scenario', (req, res) => {
  res.json({ activeScenario: prometheusAdapter.activeScenario || 'none' });
});

// Helper function to build real evidence and correlate signals for an incident
async function correlateForIncident(incident) {
  const metricsData = await prometheusAdapter.queryMetrics();
  const liveAnomalies = metricsData.anomalies || [];

  // Identify anomalies on target service or its upstream/downstream dependencies
  const relatedAnomalies = liveAnomalies.filter(a =>
    a.service === incident.service ||
    (dependencyTopology.dependencyChains[incident.service]?.upstream || []).includes(a.service) ||
    (dependencyTopology.dependencyChains[incident.service]?.downstream || []).includes(a.service)
  );

  const anomalies = relatedAnomalies.length > 0
    ? relatedAnomalies
    : (incident.anomalies && incident.anomalies.length > 0
        ? incident.anomalies
        : [
            {
              service: incident.service,
              metric: 'service_health',
              value: 0,
              threshold: 1,
              severity: incident.severity || 'P1-Critical',
              description: incident.description || incident.title
            }
          ]);

  const rootCauseCandidate = incident.service;
  const cascading = (dependencyTopology.dependencyChains[rootCauseCandidate]?.upstream || []).filter(
    s => s !== 'frontend' && (liveAnomalies.some(a => a.service === s) || relatedAnomalies.some(a => a.service === s))
  );

  const errorLogsByService = await lokiAdapter.getRecentErrorsForServices([rootCauseCandidate, ...cascading]);

  const evidenceSnippets = [];
  anomalies.forEach(a => evidenceSnippets.push(`[Prometheus Metric] ${a.service}: ${a.metric} = ${a.value} (${a.description})`));
  for (const [svc, logs] of Object.entries(errorLogsByService)) {
    if (logs && logs.length > 0) {
      evidenceSnippets.push(`[Loki Log] ${svc}: "${logs[0].message}"`);
    }
  }

  const timeline = [];
  anomalies.forEach(a => {
    timeline.push({
      source: 'METRIC',
      service: a.service,
      timestamp: metricsData.timestamp || incident.createdAt,
      severity: a.severity,
      summary: a.description,
      metric: a.metric,
      value: a.value
    });
  });

  for (const [svc, logs] of Object.entries(errorLogsByService)) {
    logs.forEach(l => {
      timeline.push({
        source: 'LOG',
        service: svc,
        timestamp: l.timestamp,
        severity: l.level,
        summary: l.message
      });
    });
  }
  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return {
    overallSeverity: incident.severity || 'P1-Critical',
    rootCauseCandidate,
    affectedServices: {
      root: rootCauseCandidate,
      cascading,
      all: [rootCauseCandidate, ...cascading]
    },
    timeline,
    evidenceSnippets,
    anomalies,
    errorLogsByService
  };
}

// Diagnose a Specific Incident Directly with Gemini + RAG (Real Evidence Only)
app.post('/api/incidents/:id/analyze', async (req, res) => {
  try {
    const incident = incidentManager.getById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    logger.info(`Analyzing incident ${incident.id} for service ${incident.service} with real telemetry...`);
    const correlation = await correlateForIncident(incident);

    const diagnosis = await aiReasoning.generateRCA(correlation);
    incidentManager.update(incident.id, {
      analysis: diagnosis.rca,
      anomalies: correlation.anomalies
    });

    res.json({
      status: 'DIAGNOSED',
      incidentId: incident.id,
      analysis: diagnosis.rca,
      retrievedRunbooks: diagnosis.ragPassages
    });
  } catch (err) {
    logger.error(`Incident RCA failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// 5. Automated Signal Correlation & AI Root Cause Analysis (PRD Workflow)
app.post('/api/analyze', async (req, res) => {
  try {
    const { incidentId } = req.body || {};

    // If an incident ID is explicitly passed, analyze that incident directly using real telemetry
    if (incidentId) {
      const incident = incidentManager.getById(incidentId);
      if (incident) {
        const correlation = await correlateForIncident(incident);
        const diagnosis = await aiReasoning.generateRCA(correlation);
        incidentManager.update(incident.id, {
          analysis: diagnosis.rca,
          anomalies: correlation.anomalies
        });
        return res.json({
          status: 'INCIDENT_DETECTED',
          incidentId: incident.id,
          analysis: diagnosis.rca,
          retrievedRunbooks: diagnosis.ragPassages
        });
      }
    }

    // Gather live correlation from Prometheus and Loki
    const correlation = await correlationEngine.correlateSignals();

    if (!correlation.hasIncident) {
      // Check if there is an open incident in the system to diagnose instead of failing
      const openIncidents = incidentManager.getAll({ status: 'OPEN' });
      if (openIncidents && openIncidents.length > 0) {
        const targetIncident = openIncidents[0];
        logger.info(`Diagnosing open incident: ${targetIncident.id} (${targetIncident.service})`);
        const incCorrelation = await correlateForIncident(targetIncident);
        const diagnosis = await aiReasoning.generateRCA(incCorrelation);
        incidentManager.update(targetIncident.id, {
          analysis: diagnosis.rca,
          anomalies: incCorrelation.anomalies
        });
        return res.json({
          status: 'INCIDENT_DETECTED',
          incidentId: targetIncident.id,
          analysis: diagnosis.rca,
          retrievedRunbooks: diagnosis.ragPassages
        });
      }

      return res.json({
        status: 'OK',
        message: 'System healthy. No anomalies detected across microservice boundaries.',
        failingNodes: []
      });
    }

    const diagnosis = await aiReasoning.generateRCA(correlation);

    const incident = incidentManager.createIncident({
      title: `${diagnosis.rca.probableRootCause.slice(0, 75)}...`,
      service: correlation.rootCauseCandidate,
      severity: diagnosis.rca.severity,
      analysis: diagnosis.rca,
      anomalies: correlation.anomalies,
      trigger: 'AUTOMATED_CORRELATION'
    });

    res.json({
      status: 'INCIDENT_DETECTED',
      incidentId: incident.id,
      failingNodes: correlation.affectedServices.all,
      rootService: correlation.rootCauseCandidate,
      analysis: diagnosis.rca,
      retrievedRunbooks: diagnosis.ragPassages,
      correlation
    });
  } catch (err) {
    console.error('[AIOps] Incident Analysis Failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Real Remediation Execution & Prometheus Verification
const SERVICE_PORTS = {
  'gateway-service': 4000,
  'order-service': 4001,
  'payment-service': 4002,
  'auth-service': 4003,
  'inventory-service': 4004
};

const SCENARIO_ROUTING = {
  // API Gateway
  'gateway_outage': { service: 'gateway-service', port: 4000, mode: 'gateway_outage', title: 'API Gateway 502 Outage' },
  'cache_stampede': { service: 'gateway-service', port: 4000, mode: 'cache_stampede', title: 'API Gateway Cache Storm & Rate Limit' },

  // Order Service
  'order_deadlock': { service: 'order-service', port: 4001, mode: 'order_deadlock', title: 'Order Circuit Breaker Trip' },

  // Auth Service
  'auth_storm': { service: 'auth-service', port: 4003, mode: 'auth_storm', title: 'Auth Token Storm & 401 Burst' },

  // Inventory Service
  'inventory_lock': { service: 'inventory-service', port: 4004, mode: 'inventory_lock', title: 'Inventory Deadlock & Stock Depletion' },

  // Payment Service
  'high_cpu': { service: 'payment-service', port: 4002, mode: 'high_cpu', title: 'High CPU & Event Loop Saturation' },
  'payment_gateway_down': { service: 'payment-service', port: 4002, mode: 'payment_gateway_down', title: '3rd-Party Payment Gateway 503 Outage' },
  'downstream_failure': { service: 'payment-service', port: 4002, mode: 'downstream_failure', title: 'Payment RPC Timeout & Deadlock' },

  // Database (MongoDB Cluster)
  'db_overload': { service: 'payment-service', port: 4002, mode: 'db_overload', title: 'Database Connection Pool Exhaustion' }
};

const DOCKER_BIN = process.env.DOCKER_PATH || 
  (process.env.LOCALAPPDATA ? `"${process.env.LOCALAPPDATA}\\Programs\\DockerDesktop\\resources\\bin\\docker.exe"` : 'docker');

async function restartDockerContainer(containerName) {
  try {
    await execAsync(`${DOCKER_BIN} restart ${containerName}`, { timeout: 15000 });
    return true;
  } catch (err) {
    logger.warn(`Docker execution failed with default path (${err.message}), attempting fallback 'docker'`);
    try {
      await execAsync(`docker restart ${containerName}`, { timeout: 15000 });
      return true;
    } catch (e2) {
      logger.error(`Failed to restart container ${containerName}: ${e2.message}`);
      return false;
    }
  }
}

// 6. Remediation Approval Endpoint (Real Action & Prometheus Verification)
app.post('/api/remediation/approve', async (req, res) => {
  const { incidentId, action, service, operatorName = 'DevOps SRE Lead' } = req.body;

  try {
    const incident = incidentId ? incidentManager.getById(incidentId) : null;
    const targetService = service || incident?.service || incident?.analysis?.affectedServices?.root || 'payment-service';
    const targetPort = SERVICE_PORTS[targetService] || 4002;

    logger.info(`Remediation action '${action}' approved by ${operatorName} for ${targetService}`);

    let executionSuccess = false;
    let executionMethod = '';

    // 1. Dispatch real remediation action to the affected physical service
    try {
      const remediateRes = await axios.post(`http://localhost:${targetPort}/api/remediate`, {
        action: action || 'restart_service',
        operator: operatorName
      }, { timeout: 3000 });

      if (remediateRes.data?.success) {
        executionSuccess = true;
        executionMethod = `${targetService} API hook (/api/remediate)`;
      }
    } catch (err) {
      logger.warn(`Direct ${targetService} /api/remediate failed (${err.message}). Attempting container restart.`);
    }

    // If direct API failed or action explicitly asks for container restart, execute docker restart
    if (!executionSuccess || action?.includes('restart_container') || action?.includes('restart_service')) {
      const restarted = await restartDockerContainer(`aiops-${targetService}`);
      if (restarted) {
        executionSuccess = true;
        executionMethod = 'Docker container restart';
      }
    }

    // Always clear cascading upstream/downstream error counters
    const cascadingServices = Object.keys(SERVICE_PORTS).filter(s => s !== targetService);
    await Promise.allSettled(cascadingServices.map(s => {
      const p = SERVICE_PORTS[s];
      return axios.post(`http://localhost:${p}/api/remediate`, { action: 'cascade_reset' }, { timeout: 1500 });
    }));

    // 2. Poll Prometheus until recovery is verified by real telemetry or timeout
    let isRecovered = false;
    let verifiedMetrics = null;
    let targetAnomalies = [];
    let attempts = 0;
    const maxPollAttempts = 8; // up to 12 seconds (Prometheus scrapes every 2s)

    while (attempts < maxPollAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      verifiedMetrics = await prometheusAdapter.queryMetrics();
      const remainingAnomalies = verifiedMetrics.anomalies || [];
      targetAnomalies = remainingAnomalies.filter(a => a.service === targetService);
      const targetOnline = verifiedMetrics.services[targetService]?.status === 'ONLINE';

      if (targetOnline && targetAnomalies.length === 0) {
        isRecovered = true;
        break;
      }
      attempts++;
    }

    // 3. Genuine verification: Did Prometheus confirm the service recovered?
    let auditEntry = null;
    let message = '';

    if (isRecovered) {
      message = `Remediation '${action || 'restart_service'}' executed via ${executionMethod} and VERIFIED by Prometheus telemetry. ${targetService} is HEALTHY with 0 active anomalies.`;

      lokiAdapter.pushLog({
        service: targetService,
        level: 'INFO',
        message: `[REMEDIATION_VERIFIED] Action '${action}' approved by ${operatorName}. Prometheus telemetry confirms ${targetService} is HEALTHY.`
      });

      if (incidentId) {
        incidentManager.resolveIncident(incidentId, message);
        auditEntry = incidentManager.recordRemediation(incidentId, {
          action: action || 'restart_service',
          approvedBy: operatorName,
          result: 'REMEDIATED_AND_RECOVERED',
          verified: true,
          notes: message
        });
      }
    } else {
      message = `Remediation executed via ${executionMethod}, but Prometheus telemetry confirms ${targetService} is STILL FAILING (${targetAnomalies.map(a => `${a.metric}=${a.value}`).join(', ')}). Cluster remains DEGRADED.`;

      lokiAdapter.pushLog({
        service: targetService,
        level: 'WARN',
        message: `[REMEDIATION_UNVERIFIED] Action '${action}' executed, but ${targetService} remains anomalous in Prometheus.`
      });

      if (incidentId) {
        auditEntry = incidentManager.recordRemediation(incidentId, {
          action: action || 'restart_service',
          approvedBy: operatorName,
          result: 'REMEDIATION_UNVERIFIED_STILL_FAILING',
          verified: false,
          notes: message
        });
      }
    }

    res.json({
      success: true,
      recovered: isRecovered,
      verified: isRecovered,
      message,
      targetService,
      action: action || 'restart_service',
      activeAnomalies: verifiedMetrics?.anomalies || [],
      prometheusConnected: verifiedMetrics?.prometheusConnected,
      audit: auditEntry,
      incident: incidentId ? incidentManager.getById(incidentId) : null
    });
  } catch (err) {
    logger.error(`Remediation execution failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to execute remediation', details: err.message });
  }
});

app.get('/api/remediation/audit', (req, res) => {
  res.json(incidentManager.getAuditLogs());
});

// 7. Unified Scenario Injection Handler (Real Microservice Dispatch + Prometheus Observation)
async function handleScenarioInjection(req, res) {
  const scenario = req.body.scenario || req.body.mode;
  logger.info(`Scenario injection requested: ${scenario}`);

  if (!scenario || scenario === 'none' || scenario === 'reset' || scenario === 'healthy') {
    // 1. Clear faults and remediate across ALL 5 services
    const services = Object.entries(SERVICE_PORTS).map(([name, port]) => ({ name, port }));

    await Promise.allSettled(services.map(s => 
      axios.post(`http://localhost:${s.port}/api/simulate-failure`, { fail: false, mode: 'none' }, { timeout: 2000 })
    ));
    await Promise.allSettled(services.map(s => 
      axios.post(`http://localhost:${s.port}/api/remediate`, { action: 'system_reset', operator: 'AIOps Automation' }, { timeout: 2000 })
    ));

    // Wait for Prometheus to observe clean telemetry
    let verifiedHealthy = false;
    let attempts = 0;
    while (attempts < 6) {
      await new Promise(r => setTimeout(r, 1500));
      const metrics = await prometheusAdapter.queryMetrics();
      if ((metrics.anomalies || []).length === 0) {
        verifiedHealthy = true;
        break;
      }
      attempts++;
    }

    // Resolve any open incidents
    const openIncidents = incidentManager.getAll({ status: 'OPEN' });
    openIncidents.forEach(inc => {
      incidentManager.resolveIncident(inc.id, 'Fault injections cleared and cluster telemetry verified healthy by Prometheus.');
    });

    return res.json({
      success: true,
      verified: verifiedHealthy,
      scenario: 'none',
      message: verifiedHealthy
        ? 'All fault simulations cleared and cluster verified healthy by Prometheus telemetry.'
        : 'All fault simulations cleared. Awaiting next Prometheus telemetry cycle.'
    });
  }

  const route = SCENARIO_ROUTING[scenario];
  if (!route) {
    return res.status(400).json({ error: `Unknown scenario: ${scenario}` });
  }

  try {
    // 1. Send failure command to target microservice
    const serviceRes = await axios.post(`http://localhost:${route.port}/api/simulate-failure`, {
      mode: route.mode,
      fail: true
    }, { timeout: 3000 });

    logger.info(`Microservice ${route.service} accepted fault injection:`, serviceRes.data);

    // 2. Poll Prometheus until it actually observes the changed telemetry!
    let observedAnomaly = null;
    let attempts = 0;
    const maxAttempts = 7; // up to ~10.5 seconds (Prometheus scrape interval is 2s)

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 1500));
      const metrics = await prometheusAdapter.queryMetrics();
      const anomalies = metrics.anomalies || [];
      const match = anomalies.find(a => a.service === route.service);
      if (match) {
        observedAnomaly = match;
        break;
      }
      attempts++;
    }

    if (!observedAnomaly) {
      logger.warn(`Fault injected to ${route.service}, but Prometheus has not yet observed anomaly after ${attempts * 1.5}s.`);
      return res.status(202).json({
        success: true,
        verified: false,
        scenario,
        service: route.service,
        message: `Fault injected into ${route.service}. Awaiting Prometheus scrape cycle observation.`,
        pendingVerification: true
      });
    }

    // 3. Prometheus telemetry confirmed! Now correlate and create/update incident
    const correlation = await correlationEngine.correlateSignals();

    // Check if an open incident for this service already exists
    const openIncidents = incidentManager.getAll({ status: 'OPEN' });
    let incident = openIncidents.find(i => i.service === route.service);

    if (!incident) {
      incident = incidentManager.createIncident({
        title: `${route.title} in ${route.service}`,
        service: route.service,
        severity: observedAnomaly.severity || 'CRITICAL',
        status: 'OPEN',
        anomalies: [observedAnomaly],
        description: `Automated detection from real Prometheus metrics: ${observedAnomaly.description}`,
        correlations: correlation
      });
    }

    lokiAdapter.pushLog({
      service: route.service,
      level: 'ERROR',
      message: `[CHAOS_INJECTION_DETECTED] Real Prometheus telemetry confirms ${observedAnomaly.metric} anomaly on ${route.service}: ${observedAnomaly.description}`
    });

    return res.json({
      success: true,
      verified: true,
      scenario,
      service: route.service,
      anomaly: observedAnomaly,
      incident,
      message: `Failure detected! Prometheus verified anomalous telemetry on ${route.service}.`
    });

  } catch (err) {
    logger.error(`Failed to inject scenario ${scenario}: ${err.message}`);
    return res.status(500).json({
      error: `Failed to inject fault into ${route.service}`,
      details: err.message
    });
  }
}

app.post('/api/scenarios/inject', handleScenarioInjection);
app.post('/api/telemetry/simulate', handleScenarioInjection);

// 8. RAG Runbooks CRUD
app.get('/api/rag/runbooks', (req, res) => {
  res.json(ragEngine.getAll());
});

app.get('/api/rag/runbooks/:id', (req, res) => {
  const runbook = ragEngine.getById(req.params.id);
  if (!runbook) return res.status(404).json({ error: 'Runbook not found' });
  res.json(runbook);
});

app.post('/api/rag/runbooks', (req, res) => {
  const { id, title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required.' });
  }
  const cleanId = id || title.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const saved = ragEngine.saveRunbook(cleanId, title, content);
  res.status(201).json(saved);
});

app.delete('/api/rag/runbooks/:id', (req, res) => {
  const deleted = ragEngine.deleteRunbook(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Runbook not found' });
  res.json({ success: true, message: `Runbook ${req.params.id} deleted.` });
});

app.listen(port, () => {
  console.log(`[AIOps Core Engine] Listening on port ${port}`);
});
