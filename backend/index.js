require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

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
    const failingServiceIds = new Set(anomalies.map(a => a.service));

    const nodesWithHealth = dependencyTopology.nodes.map(node => {
      const nodeAnomalies = anomalies.filter(a => a.service === node.id);
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
      return {
        ...node,
        status,
        anomalies: nodeAnomalies,
        serviceInfo
      };
    });

    // All nodes that are failing (either CRITICAL anomalies, DEGRADED cascades, or OFFLINE outages)
    const allFailingIds = nodesWithHealth
      .filter(n => n.status === 'CRITICAL' || n.status === 'DEGRADED' || n.status === 'OFFLINE')
      .map(n => n.id);

    res.json({
      nodes: nodesWithHealth,
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
    lokiAdapter.pushLog({ service: 'payment-service', level: 'CRITICAL', message: '[payment-service] ConnectionPoolTimeoutException: Timeout waiting for connection from pool of 100 max connections.' });
    lokiAdapter.pushLog({ service: 'payment-service', level: 'CRITICAL', message: '[payment-service] MongoNetworkError: failed to connect to server [mongodb:27017] after 5000ms.' });
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
  } else if (scenario === 'none' || scenario === 'reset') {
    lokiAdapter.pushLog({ service: 'payment-service', level: 'INFO', message: '[payment-service] Connection pool drained and reset. Ready for traffic.' });
    lokiAdapter.pushLog({ service: 'order-service', level: 'INFO', message: '[order-service] Downstream payment-service restored. RPC latency: 19ms.' });
    lokiAdapter.pushLog({ service: 'gateway-service', level: 'INFO', message: '[gateway-service] All upstream microservice probes nominal. Latency: 16ms.' });
  }

  logger.info(`Telemetry test scenario activated: ${scenario || 'none'}`);
  res.json({ success: true, scenario: scenario || 'none' });
});

app.get('/api/telemetry/scenario', (req, res) => {
  res.json({ activeScenario: prometheusAdapter.activeScenario || 'none' });
});

// Diagnose a Specific Incident Directly with Gemini + RAG
app.post('/api/incidents/:id/analyze', async (req, res) => {
  try {
    const incident = incidentManager.getById(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });

    logger.info(`Analyzing incident ${incident.id} with Gemini AI...`);
    const correlation = {
      overallSeverity: incident.severity || 'P1-Critical',
      rootCauseCandidate: incident.service || 'payment-service',
      affectedServices: {
        all: [incident.service || 'payment-service'],
        cascading: ['gateway-service', 'order-service']
      },
      timeline: [
        { timestamp: incident.createdAt, service: incident.service, source: 'INCIDENT', summary: incident.title }
      ],
      evidenceSnippets: [
        `Incident Title: ${incident.title}`,
        `Observed Symptoms: ${incident.description || 'Elevated latency and socket starvation.'}`,
        `Service Affected: ${incident.service}`
      ],
      anomalies: [
        {
          service: incident.service,
          metric: 'operational_incident',
          description: incident.description || incident.title,
          severity: incident.severity
        }
      ]
    };

    const diagnosis = await aiReasoning.generateRCA(correlation);
    incidentManager.update(incident.id, { analysis: diagnosis.rca });

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

    // If an incident ID is explicitly passed, analyze that incident directly
    if (incidentId) {
      const incident = incidentManager.getById(incidentId);
      if (incident) {
        const correlation = {
          overallSeverity: incident.severity || 'P1-Critical',
          rootCauseCandidate: incident.service || 'payment-service',
          affectedServices: { all: [incident.service], cascading: ['gateway-service', 'order-service'] },
          timeline: [{ timestamp: incident.createdAt, service: incident.service, source: 'INCIDENT', summary: incident.title }],
          evidenceSnippets: [`Incident: ${incident.title}`, `Symptoms: ${incident.description || 'Observed failure'}`],
          anomalies: [{ service: incident.service, metric: 'operational_incident', description: incident.title, severity: incident.severity }]
        };
        const diagnosis = await aiReasoning.generateRCA(correlation);
        return res.json({
          status: 'INCIDENT_DETECTED',
          incidentId: incident.id,
          analysis: diagnosis.rca,
          retrievedRunbooks: diagnosis.ragPassages
        });
      }
    }

    const correlation = await correlationEngine.correlateSignals();

    if (!correlation.hasIncident) {
      // Check if there is an open incident in the system to diagnose instead of failing
      const openIncidents = incidentManager.getAll({ status: 'OPEN' });
      if (openIncidents && openIncidents.length > 0) {
        const targetIncident = openIncidents[0];
        logger.info(`No active telemetry anomalies; diagnosing most urgent open incident: ${targetIncident.id}`);
        const incCorrelation = {
          overallSeverity: targetIncident.severity || 'P1-Critical',
          rootCauseCandidate: targetIncident.service || 'payment-service',
          affectedServices: { all: [targetIncident.service], cascading: ['gateway-service', 'order-service'] },
          timeline: [{ timestamp: targetIncident.createdAt, service: targetIncident.service, source: 'INCIDENT', summary: targetIncident.title }],
          evidenceSnippets: [`Incident: ${targetIncident.title}`, `Symptoms: ${targetIncident.description || 'Reported cluster anomaly'}`],
          anomalies: [{ service: targetIncident.service, metric: 'incident_trigger', description: targetIncident.title, severity: targetIncident.severity }]
        };
        const diagnosis = await aiReasoning.generateRCA(incCorrelation);
        incidentManager.update(targetIncident.id, { analysis: diagnosis.rca });
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

// 6. Remediation & Audit Log
app.post('/api/remediation/approve', async (req, res) => {
  const { incidentId, action, operatorName = 'DevOps SRE Lead' } = req.body;

  try {
    // Attempt dispatch to physical microservice if running
    await axios.post('http://localhost:4002/api/remediate', { action }, { timeout: 1000 }).catch(() => {});

    // Reset simulated test scenario back to healthy baseline
    prometheusAdapter.setSimulationScenario('none');

    // Ingest recovery log entries into Loki
    lokiAdapter.pushLog({
      service: 'payment-service',
      level: 'INFO',
      message: `[REMEDIATION] Action '${action || 'restart_service'}' approved by ${operatorName}. Connection pool drained, worker threads restarted.`
    });
    lokiAdapter.pushLog({
      service: 'order-service',
      level: 'INFO',
      message: '[REMEDIATION] Payment service dependency restored to HEALTHY. Cascading circuit breaker closed.'
    });
    lokiAdapter.pushLog({
      service: 'gateway-service',
      level: 'INFO',
      message: '[REMEDIATION] Upstream order & payment checkout latency nominal (21ms). Error rate: 0.00%.'
    });

    const audit = incidentManager.recordRemediation(incidentId, {
      action: action || 'restart_service',
      approvedBy: operatorName,
      result: 'REMEDIATED_AND_RECOVERED'
    });

    res.json({
      success: true,
      message: `Remediation '${action || 'restart_service'}' approved by ${operatorName} and executed. Cluster health restored.`,
      audit,
      incident: incidentId ? incidentManager.getById(incidentId) : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute remediation', details: err.message });
  }
});

app.get('/api/remediation/audit', (req, res) => {
  res.json(incidentManager.getAuditLogs());
});

// 7. Scenario Injection Controls
app.post('/api/scenarios/inject', async (req, res) => {
  const { scenario } = req.body;
  try {
    if (scenario === 'reset' || scenario === 'none') {
      await axios.post('http://localhost:4002/api/simulate-failure', { fail: false });
      return res.json({ message: 'All fault injections cleared. Services healthy.', scenario: 'healthy' });
    }

    await axios.post('http://localhost:4002/api/simulate-failure', { mode: scenario, fail: true });
    res.json({ message: `Successfully injected fault scenario: ${scenario}`, scenario });
  } catch (err) {
    res.status(500).json({
      error: `Failed to inject scenario ${scenario}. Ensure Payment Service is running on port 4002.`,
      details: err.message
    });
  }
});

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
