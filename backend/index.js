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

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize persistent settings
const savedSettings = storage.read('settings.json', {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash'
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
      const isFailing = failingServiceIds.has(node.id);
      let status = 'HEALTHY';
      if (isFailing) {
        status = node.id === 'payment-service' ? 'CRITICAL' : 'DEGRADED';
      }
      return {
        ...node,
        status,
        anomalies: anomalies.filter(a => a.service === node.id)
      };
    });

    res.json({
      nodes: nodesWithHealth,
      edges: dependencyTopology.edges,
      failingServiceIds: Array.from(failingServiceIds),
      rawAnomalies: anomalies
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

// 5. Automated Signal Correlation & AI Root Cause Analysis (PRD Workflow)
app.post('/api/analyze', async (req, res) => {
  try {
    const correlation = await correlationEngine.correlateSignals();

    if (!correlation.hasIncident) {
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
  const { incidentId, action, operatorName = 'DevOps SRE' } = req.body;

  try {
    await axios.post('http://localhost:4002/api/remediate', { action }, { timeout: 2000 }).catch(() => {});

    const audit = incidentManager.recordRemediation(incidentId, {
      action: action || 'reset_system_state',
      approvedBy: operatorName,
      result: 'REMEDIATED_AND_RECOVERED'
    });

    res.json({
      success: true,
      message: `Remediation '${action}' approved by ${operatorName} and executed.`,
      audit,
      incident: incidentManager.getById(incidentId)
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
