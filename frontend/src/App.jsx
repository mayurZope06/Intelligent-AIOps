import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { Background, Controls, MarkerType, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import axios from 'axios';
import {
  Activity, AlertTriangle, CheckCircle2, Play, ShieldAlert,
  Server, Database, Terminal, RefreshCw, Layers, BookOpen,
  History, Settings, Zap, ArrowRight, ShieldCheck, Check,
  Search, Plus, Trash2, Edit3, ExternalLink, X, MessageSquare,
  Clock, Filter, Shield, AlertCircle
} from 'lucide-react';

const API_BASE = 'http://localhost:5000/api';

// Custom ReactFlow Node for Enterprise Services
const ServiceNode = ({ data, selected }) => {
  const status = (data.status || 'HEALTHY').toLowerCase();
  const Icon = data.type === 'database' ? Database : data.type === 'client' ? Layers : Server;

  return (
    <div className={`rf-node-custom ${status} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ background: '#6366f1', width: 6, height: 6 }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={14} color={status === 'critical' ? '#f43f5e' : status === 'degraded' ? '#f59e0b' : '#10b981'} />
          <span style={{ fontWeight: 600, fontSize: '12px' }}>{data.name}</span>
        </div>
        <span className={`badge badge-${status === 'critical' ? 'critical' : status === 'degraded' ? 'warning' : 'healthy'}`}>
          {data.status || 'HEALTHY'}
        </span>
      </div>
      <div style={{ fontSize: '11px', color: '#a1a1aa', display: 'flex', justifyContent: 'space-between' }}>
        <span className="font-mono">:{data.port || '27017'}</span>
        <span>{data.team}</span>
      </div>
      {data.anomalies && data.anomalies.length > 0 && (
        <div style={{ marginTop: 6, fontSize: '10px', color: '#fb7185', background: 'rgba(244,63,94,0.1)', padding: '2px 6px', borderRadius: 4 }}>
          {data.anomalies[0].metric}: {data.anomalies[0].value}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: '#6366f1', width: 6, height: 6 }} />
    </div>
  );
};

const nodeTypes = {
  serviceNode: ServiceNode
};

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState('topology'); // 'topology' | 'incidents' | 'telemetry' | 'runbooks' | 'audit'

  // Topology State
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  // Incidents State (Full CRUD)
  const [incidents, setIncidents] = useState([]);
  const [incidentMetrics, setIncidentMetrics] = useState({ totalIncidents: 0, openIncidents: 0, resolvedIncidents: 0, averageMTTRSeconds: 0 });
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [incidentFilterStatus, setIncidentFilterStatus] = useState('ALL');
  const [incidentFilterSeverity, setIncidentFilterSeverity] = useState('ALL');
  const [incidentSearch, setIncidentSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newIncidentForm, setNewIncidentForm] = useState({ title: '', service: 'payment-service', severity: 'P1-Critical', description: '' });
  const [newNoteText, setNewNoteText] = useState('');

  // AI Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [latestRcaReport, setLatestRcaReport] = useState(null);
  const [remediating, setRemediating] = useState(false);

  // Telemetry & Logs State
  const [metricsData, setMetricsData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logFilterService, setLogFilterService] = useState('all');
  const [logFilterLevel, setLogFilterLevel] = useState('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);

  // Runbooks State (Full CRUD)
  const [runbooks, setRunbooks] = useState([]);
  const [selectedRunbook, setSelectedRunbook] = useState(null);
  const [showRunbookModal, setShowRunbookModal] = useState(false);
  const [runbookForm, setRunbookForm] = useState({ id: '', title: '', content: '' });

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);

  // Scenarios & Traffic
  const [selectedScenario, setSelectedScenario] = useState('none');
  const [trafficActive, setTrafficActive] = useState(false);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.0-flash');
  const [settingsStatus, setSettingsStatus] = useState(null);

  // Loading & Error States
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);

  // 1. Fetch Topology Graph
  const fetchGraph = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/graph`);
      const rawNodes = res.data.nodes || [];
      const rawEdges = res.data.edges || [];

      const positions = {
        'frontend': { x: 30, y: 160 },
        'gateway-service': { x: 250, y: 160 },
        'order-service': { x: 470, y: 160 },
        'payment-service': { x: 690, y: 160 },
        'database': { x: 910, y: 160 }
      };

      const flowNodes = rawNodes.map(n => ({
        id: n.id,
        type: 'serviceNode',
        position: positions[n.id] || { x: 100, y: 100 },
        data: {
          name: n.name,
          status: n.status,
          port: n.port,
          team: n.team,
          type: n.type,
          anomalies: n.anomalies
        }
      }));

      const flowEdges = rawEdges.map(e => {
        const isFailing = res.data.failingServiceIds?.includes(e.source) || res.data.failingServiceIds?.includes(e.target);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: true,
          style: {
            stroke: isFailing ? '#f43f5e' : '#6366f1',
            strokeWidth: isFailing ? 2 : 1.2
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isFailing ? '#f43f5e' : '#6366f1'
          }
        };
      });

      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (err) {
      console.error('Failed to load topology:', err);
    }
  }, []);

  // 2. Fetch Incidents (CRUD list)
  const fetchIncidents = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/incidents`, {
        params: {
          status: incidentFilterStatus,
          severity: incidentFilterSeverity,
          search: incidentSearch
        }
      });
      setIncidents(res.data.incidents || []);
      if (res.data.metrics) setIncidentMetrics(res.data.metrics);
    } catch (err) {
      console.error('Failed to load incidents:', err);
    }
  }, [incidentFilterStatus, incidentFilterSeverity, incidentSearch]);

  // 3. Fetch Telemetry Metrics and Logs
  const fetchTelemetry = useCallback(async () => {
    try {
      const [mRes, lRes] = await Promise.all([
        axios.get(`${API_BASE}/telemetry/metrics`),
        axios.get(`${API_BASE}/telemetry/logs`, {
          params: { service: logFilterService, level: logFilterLevel, limit: 60 }
        })
      ]);
      setMetricsData(mRes.data);
      setLogs(lRes.data || []);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage('AIOps backend connection offline. Ensure port 5000 is running.');
    } finally {
      setIsLoading(false);
    }
  }, [logFilterService, logFilterLevel]);

  // 4. Fetch Runbooks
  const fetchRunbooks = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/rag/runbooks`);
      setRunbooks(res.data || []);
      if (res.data.length > 0 && !selectedRunbook) {
        setSelectedRunbook(res.data[0]);
      }
    } catch (err) {}
  }, [selectedRunbook]);

  // 5. Fetch Audit Logs
  const fetchAudit = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/remediation/audit`);
      setAuditLogs(res.data || []);
    } catch (err) {}
  }, []);

  // 6. Fetch Settings
  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/config/settings`);
      setSettingsStatus(res.data);
      if (res.data.model) setGeminiModel(res.data.model);
    } catch (err) {}
  }, []);

  // Polling Loop
  useEffect(() => {
    fetchGraph();
    fetchIncidents();
    fetchTelemetry();
    fetchRunbooks();
    fetchAudit();
    fetchSettings();

    const interval = setInterval(() => {
      fetchGraph();
      fetchIncidents();
      if (autoRefreshLogs) fetchTelemetry();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchGraph, fetchIncidents, fetchTelemetry, fetchRunbooks, fetchAudit, fetchSettings, autoRefreshLogs]);

  // Trigger AI Root Cause Analysis
  const triggerAiRca = async () => {
    setIsAnalyzing(true);
    try {
      const res = await axios.post(`${API_BASE}/analyze`);
      if (res.data.status === 'OK') {
        alert('Cluster healthy. No anomalous telemetry detected.');
        setLatestRcaReport(null);
      } else {
        setLatestRcaReport(res.data.analysis);
        fetchIncidents();
        fetchGraph();
        // Automatically select the newly created incident
        if (res.data.incidentId) {
          const incRes = await axios.get(`${API_BASE}/incidents/${res.data.incidentId}`);
          setSelectedIncident(incRes.data);
        }
      }
    } catch (err) {
      alert(`AI RCA Failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Scenario Injection
  const handleScenarioChange = async (e) => {
    const scenario = e.target.value;
    setSelectedScenario(scenario);
    try {
      await axios.post(`${API_BASE}/scenarios/inject`, { scenario });
      setTimeout(() => {
        fetchGraph();
        fetchTelemetry();
      }, 500);
    } catch (err) {
      alert(`Scenario injection failed: ${err.message}`);
    }
  };

  // Toggle Customer Traffic
  const toggleTraffic = async () => {
    try {
      if (trafficActive) {
        await axios.post('http://localhost:4000/api/traffic/stop');
        setTrafficActive(false);
      } else {
        await axios.post('http://localhost:4000/api/traffic/start');
        setTrafficActive(true);
      }
    } catch (err) {
      alert('API Gateway not responding on port 4000.');
    }
  };

  // Human-in-the-Loop Remediation Approval
  const approveRemediation = async (incidentId, actionType) => {
    setRemediating(true);
    try {
      await axios.post(`${API_BASE}/remediation/approve`, {
        incidentId,
        action: actionType || 'restart_pool',
        operatorName: 'DevOps SRE Lead'
      });
      setSelectedScenario('none');
      fetchIncidents();
      fetchGraph();
      fetchAudit();
      if (selectedIncident?.id === incidentId) {
        const updated = await axios.get(`${API_BASE}/incidents/${incidentId}`);
        setSelectedIncident(updated.data);
      }
      alert('Remediation action successfully approved and executed. Service state restored.');
    } catch (err) {
      alert(`Remediation failed: ${err.message}`);
    } finally {
      setRemediating(false);
    }
  };

  // Create Incident
  const handleCreateIncident = async (e) => {
    e.preventDefault();
    if (!newIncidentForm.title) return;
    try {
      const res = await axios.post(`${API_BASE}/incidents`, newIncidentForm);
      setShowCreateModal(false);
      setNewIncidentForm({ title: '', service: 'payment-service', severity: 'P1-Critical', description: '' });
      fetchIncidents();
      setSelectedIncident(res.data);
    } catch (err) {
      alert(`Failed to create incident: ${err.message}`);
    }
  };

  // Update Incident Status
  const handleUpdateStatus = async (id, status) => {
    try {
      const res = await axios.patch(`${API_BASE}/incidents/${id}`, { status });
      fetchIncidents();
      setSelectedIncident(res.data);
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  // Delete Incident
  const handleDeleteIncident = async (id) => {
    if (!confirm(`Are you sure you want to permanently delete incident ${id}?`)) return;
    try {
      await axios.delete(`${API_BASE}/incidents/${id}`);
      fetchIncidents();
      if (selectedIncident?.id === id) setSelectedIncident(null);
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // Add Incident Note
  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!newNoteText.trim() || !selectedIncident) return;
    try {
      await axios.post(`${API_BASE}/incidents/${selectedIncident.id}/notes`, {
        author: 'SRE-Operator',
        text: newNoteText
      });
      setNewNoteText('');
      const updated = await axios.get(`${API_BASE}/incidents/${selectedIncident.id}`);
      setSelectedIncident(updated.data);
      fetchIncidents();
    } catch (err) {
      alert('Failed to add note');
    }
  };

  // Save Runbook (Create/Edit)
  const handleSaveRunbook = async (e) => {
    e.preventDefault();
    if (!runbookForm.title || !runbookForm.content) return;
    try {
      const res = await axios.post(`${API_BASE}/rag/runbooks`, runbookForm);
      setShowRunbookModal(false);
      setRunbookForm({ id: '', title: '', content: '' });
      fetchRunbooks();
      setSelectedRunbook(res.data);
    } catch (err) {
      alert(`Failed to save runbook: ${err.message}`);
    }
  };

  // Delete Runbook
  const handleDeleteRunbook = async (id) => {
    if (!confirm(`Delete runbook ${id}?`)) return;
    try {
      await axios.delete(`${API_BASE}/rag/runbooks/${id}`);
      setSelectedRunbook(null);
      fetchRunbooks();
    } catch (err) {
      alert(`Failed to delete runbook: ${err.message}`);
    }
  };

  // Save Settings
  const handleSaveSettings = async () => {
    try {
      await axios.post(`${API_BASE}/config/settings`, {
        apiKey: geminiApiKey,
        model: geminiModel
      });
      setShowSettings(false);
      fetchSettings();
      alert('Gemini settings saved persistently to disk.');
    } catch (err) {
      alert('Failed to save settings.');
    }
  };

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (!logSearch) return true;
      return l.message?.toLowerCase().includes(logSearch.toLowerCase()) ||
             l.service?.toLowerCase().includes(logSearch.toLowerCase());
    });
  }, [logs, logSearch]);

  const hasCriticalIncident = nodes.some(n => n.data?.status === 'CRITICAL');

  return (
    <div className="app-shell">
      {/* Enterprise Top Navigation Bar */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} color="#6366f1" />
            <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.01em' }}>
              Intelligent AIOps
            </span>
            <span className="badge badge-info" style={{ fontSize: '9px', padding: '1px 5px' }}>v1.0-SPPU</span>
          </div>

          <div style={{ height: 16, width: 1, background: 'var(--border-subtle)' }} />

          {/* Navigation Tabs */}
          <nav className="nav-tab-list">
            <button className={`nav-tab ${activeTab === 'topology' ? 'active' : ''}`} onClick={() => setActiveTab('topology')}>
              <Layers size={13} /> Topology
            </button>
            <button className={`nav-tab ${activeTab === 'incidents' ? 'active' : ''}`} onClick={() => setActiveTab('incidents')}>
              <ShieldAlert size={13} /> Incidents
              {incidentMetrics.openIncidents > 0 && (
                <span className="badge badge-critical" style={{ fontSize: '9px', padding: '0 4px', marginLeft: 2 }}>
                  {incidentMetrics.openIncidents}
                </span>
              )}
            </button>
            <button className={`nav-tab ${activeTab === 'telemetry' ? 'active' : ''}`} onClick={() => setActiveTab('telemetry')}>
              <Terminal size={13} /> Telemetry & Logs
            </button>
            <button className={`nav-tab ${activeTab === 'runbooks' ? 'active' : ''}`} onClick={() => setActiveTab('runbooks')}>
              <BookOpen size={13} /> Runbooks
            </button>
            <button className={`nav-tab ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
              <History size={13} /> Audit Trail
            </button>
          </nav>
        </div>

        {/* Global Controls & Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Cluster Health Pill */}
          <div className="surface" style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`dot ${hasCriticalIncident ? 'dot-critical' : 'dot-healthy'}`} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: hasCriticalIncident ? '#fb7185' : '#34d399' }}>
              {hasCriticalIncident ? 'Degraded Cluster' : 'Cluster Nominal'}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>| MTTR: {incidentMetrics.averageMTTRSeconds}s</span>
          </div>

          {/* Synthetic Traffic Generator */}
          <button 
            className={`btn ${trafficActive ? 'btn-danger' : 'btn-outline'}`}
            onClick={toggleTraffic}
            title="Inject continuous client checkout transactions via API Gateway"
          >
            <Zap size={13} />
            {trafficActive ? 'Stop Traffic' : 'Start Traffic'}
          </button>

          {/* Controlled Scenario Injector (PRD Sec 18) */}
          <select 
            className="select font-mono" 
            value={selectedScenario} 
            onChange={handleScenarioChange}
            style={{ fontSize: '11px', padding: '5px 8px' }}
          >
            <option value="none">Baseline (No Fault)</option>
            <option value="db_failure">Fault 1: DB Pool Exhaustion</option>
            <option value="high_cpu">Fault 2: High CPU Throttle (94%)</option>
            <option value="crash_loop">Fault 3: Container CrashLoop (139)</option>
            <option value="cascading_timeout">Fault 4: Downstream Timeout Cascade</option>
            <option value="reset">System Reset</option>
          </select>

          {/* AI RCA Trigger Button */}
          <button 
            className="btn btn-primary"
            onClick={triggerAiRca}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? <RefreshCw size={13} className="spin" /> : <ShieldCheck size={13} />}
            {isAnalyzing ? 'Correlating...' : 'Run AI RCA'}
          </button>

          {/* Settings */}
          <button 
            className="btn btn-subtle" 
            onClick={() => setShowSettings(true)}
            title="Configure Google Gemini API & Model"
            style={{ padding: 6 }}
          >
            <Settings size={15} />
          </button>
        </div>
      </header>

      {/* Error Banner if Backend Offline */}
      {errorMessage && (
        <div style={{ background: '#be123c', color: '#fff', padding: '6px 16px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} />
            <span>{errorMessage}</span>
          </div>
          <button className="btn btn-outline" style={{ padding: '2px 8px', fontSize: '11px', color: '#fff' }} onClick={fetchTelemetry}>
            Retry Connection
          </button>
        </div>
      )}

      {/* Main View Area */}
      <main className="main-view">
        {/* ========================================================================= */}
        {/* TAB 1: TOPOLOGY & GRAPH VIEW                                             */}
        {/* ========================================================================= */}
        {activeTab === 'topology' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                onNodeClick={(_, node) => setSelectedNode(node.data)}
              >
                <Background color="rgba(255,255,255,0.03)" gap={16} />
                <Controls />
              </ReactFlow>

              {/* Node Inspector Drawer Overlay */}
              {selectedNode && (
                <div 
                  className="surface-card"
                  style={{
                    position: 'absolute', bottom: 16, left: 16, width: 380,
                    padding: 14, zIndex: 10
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Server size={14} color="#6366f1" />
                      <span className="text-heading">{selectedNode.name}</span>
                    </div>
                    <button className="btn btn-subtle" style={{ padding: 2 }} onClick={() => setSelectedNode(null)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-secondary)' }}>
                    <div>Status: <strong style={{ color: selectedNode.status === 'CRITICAL' ? '#f43f5e' : '#10b981' }}>{selectedNode.status}</strong></div>
                    <div>Port: <span className="font-mono">:{selectedNode.port}</span> | Team: {selectedNode.team}</div>
                    {selectedNode.anomalies?.length > 0 && (
                      <div style={{ color: '#fb7185', marginTop: 4 }}>
                        Detected Anomaly: {selectedNode.anomalies[0].description}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Side: RCA & Investigation Panel */}
            <div className="drawer-panel" style={{ width: 440, padding: 16, gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="text-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldAlert size={14} color="#6366f1" />
                  Investigation & RCA
                </span>
                {latestRcaReport && (
                  <span className="badge badge-critical">{latestRcaReport.severity}</span>
                )}
              </div>

              {!latestRcaReport && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 10, color: 'var(--text-muted)', padding: 20 }}>
                  <CheckCircle2 size={36} color="#10b981" />
                  <div className="text-heading">No Active RCA Investigation</div>
                  <p className="text-sub">
                    Select a failure mode above or click <strong>Run AI RCA</strong> to generate an evidence-backed incident report.
                  </p>
                </div>
              )}

              {latestRcaReport && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Root Cause Banner */}
                  <div className="surface" style={{ padding: 12, borderLeft: '3px solid #f43f5e' }}>
                    <div className="text-xs" style={{ color: '#f43f5e', fontWeight: 600 }}>ORIGINATING SERVICE</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginTop: 2 }}>
                      {latestRcaReport.affectedServices?.root?.toUpperCase()}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                      Confidence Score: <strong className="font-mono" style={{ color: '#38bdf8' }}>{latestRcaReport.confidence}%</strong>
                    </div>
                  </div>

                  {/* Summary */}
                  <div className="surface" style={{ padding: 12 }}>
                    <div className="text-xs" style={{ fontWeight: 600, color: '#6366f1' }}>1. INCIDENT SUMMARY</div>
                    <div className="text-sub" style={{ marginTop: 4, lineHeight: 1.4 }}>{latestRcaReport.incidentSummary}</div>
                  </div>

                  {/* Root Cause */}
                  <div className="surface" style={{ padding: 12 }}>
                    <div className="text-xs" style={{ fontWeight: 600, color: '#f43f5e' }}>2. PROBABLE ROOT CAUSE</div>
                    <div className="text-sub" style={{ marginTop: 4, color: '#fca5a5', lineHeight: 1.4 }}>{latestRcaReport.probableRootCause}</div>
                  </div>

                  {/* Timeline */}
                  {latestRcaReport.timeline?.length > 0 && (
                    <div className="surface" style={{ padding: 12 }}>
                      <div className="text-xs" style={{ fontWeight: 600, color: '#06b6d4' }}>3. CHRONOLOGICAL TIMELINE</div>
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {latestRcaReport.timeline.map((ev, i) => (
                          <div key={i} style={{ fontSize: '11px', display: 'flex', gap: 6 }}>
                            <span className="font-mono text-xs">{ev.time}</span>
                            <span style={{ color: ev.type === 'origin' ? '#f43f5e' : '#a1a1aa' }}>[{ev.service}]</span>
                            <span style={{ flex: 1 }}>{ev.event}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* RAG Guidance */}
                  {latestRcaReport.retrievedKnowledge && (
                    <div className="surface" style={{ padding: 12, borderLeft: '3px solid #8b5cf6' }}>
                      <div className="text-xs" style={{ fontWeight: 600, color: '#c084fc' }}>
                        4. RAG RUNBOOK ({latestRcaReport.retrievedKnowledge.runbookTitle})
                      </div>
                      <div className="text-sub" style={{ marginTop: 4, fontSize: '11px' }}>
                        {latestRcaReport.retrievedKnowledge.guidanceSummary}
                      </div>
                    </div>
                  )}

                  {/* Remediation Action Card */}
                  {latestRcaReport.remediation && (
                    <div className="surface" style={{ padding: 12, border: '1px solid rgba(16,185,129,0.3)' }}>
                      <div className="text-xs" style={{ fontWeight: 600, color: '#10b981' }}>5. RECOMMENDED ACTION</div>
                      <div style={{ fontSize: '12px', fontWeight: 600, marginTop: 2 }}>{latestRcaReport.remediation.title}</div>
                      <div className="text-xs" style={{ marginTop: 4, color: 'var(--text-secondary)' }}>{latestRcaReport.remediation.description}</div>
                      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                        <button 
                          className="btn btn-primary"
                          onClick={() => approveRemediation(selectedIncident?.id || 'INC-CURRENT', latestRcaReport.remediation.actionType)}
                          disabled={remediating}
                        >
                          {remediating ? 'Applying...' : 'Approve & Execute Fix'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: INCIDENT MANAGEMENT (FULL CRUD)                                   */}
        {/* ========================================================================= */}
        {activeTab === 'incidents' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            <div style={{ flex: 1, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              {/* Metrics Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <div className="surface" style={{ padding: 12 }}>
                  <div className="text-xs">Total Incidents</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4 }}>
                    {incidentMetrics.totalIncidents}
                  </div>
                </div>
                <div className="surface" style={{ padding: 12 }}>
                  <div className="text-xs">Active / Open</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: incidentMetrics.openIncidents > 0 ? '#f43f5e' : '#10b981' }}>
                    {incidentMetrics.openIncidents}
                  </div>
                </div>
                <div className="surface" style={{ padding: 12 }}>
                  <div className="text-xs">Resolved Incidents</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: '#10b981' }}>
                    {incidentMetrics.resolvedIncidents}
                  </div>
                </div>
                <div className="surface" style={{ padding: 12 }}>
                  <div className="text-xs">Mean Time to Resolution (MTTR)</div>
                  <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: '#38bdf8' }}>
                    {incidentMetrics.averageMTTRSeconds}s
                  </div>
                </div>
              </div>

              {/* Filters & Actions Bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <div style={{ position: 'relative', width: 220 }}>
                    <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
                    <input 
                      type="text" 
                      placeholder="Search incidents..." 
                      className="input" 
                      style={{ paddingLeft: 26, fontSize: '11px' }}
                      value={incidentSearch}
                      onChange={e => setIncidentSearch(e.target.value)}
                    />
                  </div>

                  <select 
                    className="select" 
                    value={incidentFilterStatus} 
                    onChange={e => setIncidentFilterStatus(e.target.value)}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="OPEN">Open</option>
                    <option value="INVESTIGATING">Investigating</option>
                    <option value="RESOLVED">Resolved</option>
                  </select>

                  <select 
                    className="select" 
                    value={incidentFilterSeverity} 
                    onChange={e => setIncidentFilterSeverity(e.target.value)}
                  >
                    <option value="ALL">All Severities</option>
                    <option value="P1-Critical">P1-Critical</option>
                    <option value="P2-High">P2-High</option>
                    <option value="P3-Medium">P3-Medium</option>
                  </select>
                </div>

                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                  <Plus size={13} /> Create Incident
                </button>
              </div>

              {/* Incidents Table */}
              <div className="surface" style={{ flex: 1, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Title</th>
                      <th>Service</th>
                      <th>Severity</th>
                      <th>Status</th>
                      <th>MTTR</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incidents.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                          No incidents match the selected filter.
                        </td>
                      </tr>
                    ) : (
                      incidents.map(inc => (
                        <tr 
                          key={inc.id} 
                          onClick={() => setSelectedIncident(inc)}
                          style={{ cursor: 'pointer', background: selectedIncident?.id === inc.id ? 'rgba(99,102,241,0.08)' : 'transparent' }}
                        >
                          <td className="font-mono" style={{ color: '#6366f1', fontWeight: 600 }}>{inc.id}</td>
                          <td style={{ fontWeight: 500 }}>{inc.title}</td>
                          <td>{inc.service}</td>
                          <td>
                            <span className={`badge badge-${inc.severity?.includes('Critical') ? 'critical' : inc.severity?.includes('High') ? 'warning' : 'info'}`}>
                              {inc.severity}
                            </span>
                          </td>
                          <td>
                            <span className={`badge badge-${inc.status === 'RESOLVED' ? 'healthy' : 'critical'}`}>
                              {inc.status}
                            </span>
                          </td>
                          <td className="font-mono">
                            {inc.resolutionDurationSeconds ? `${inc.resolutionDurationSeconds}s` : '—'}
                          </td>
                          <td className="text-xs">
                            {new Date(inc.createdAt).toLocaleTimeString()}
                          </td>
                          <td>
                            <button 
                              className="btn btn-subtle" 
                              style={{ padding: 4 }} 
                              onClick={(e) => { e.stopPropagation(); handleDeleteIncident(inc.id); }}
                              title="Delete Incident"
                            >
                              <Trash2 size={13} color="#f43f5e" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Incident Details Drawer */}
            {selectedIncident && (
              <div className="drawer-panel" style={{ padding: 16, gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="font-mono" style={{ fontSize: '13px', color: '#6366f1', fontWeight: 700 }}>
                    {selectedIncident.id}
                  </span>
                  <button className="btn btn-subtle" style={{ padding: 4 }} onClick={() => setSelectedIncident(null)}>
                    <X size={14} />
                  </button>
                </div>

                <div className="text-heading" style={{ fontSize: '15px' }}>{selectedIncident.title}</div>

                {/* Status Switcher */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="text-xs">Status:</span>
                  {['OPEN', 'INVESTIGATING', 'RESOLVED'].map(st => (
                    <button
                      key={st}
                      className={`btn ${selectedIncident.status === st ? (st === 'RESOLVED' ? 'btn-success' : 'btn-danger') : 'btn-outline'}`}
                      style={{ padding: '3px 8px', fontSize: '10px' }}
                      onClick={() => handleUpdateStatus(selectedIncident.id, st)}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {/* Description */}
                <div className="surface" style={{ padding: 10, fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {selectedIncident.description}
                </div>

                {/* AI Root Cause Report if attached */}
                {selectedIncident.analysis && (
                  <div className="surface" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="text-xs" style={{ fontWeight: 600, color: '#6366f1' }}>ROOT CAUSE ANALYSIS</div>
                    <div className="text-xs" style={{ color: '#fca5a5' }}>{selectedIncident.analysis.probableRootCause}</div>
                    {selectedIncident.analysis.remediation && selectedIncident.status !== 'RESOLVED' && (
                      <div style={{ marginTop: 6 }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ width: '100%', fontSize: '11px' }}
                          onClick={() => approveRemediation(selectedIncident.id, selectedIncident.analysis.remediation.actionType)}
                          disabled={remediating}
                        >
                          Approve Fix: {selectedIncident.analysis.remediation.title}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Remediation Audit */}
                {selectedIncident.remediationAudit && (
                  <div className="surface" style={{ padding: 10, borderLeft: '3px solid #10b981' }}>
                    <div className="text-xs" style={{ color: '#10b981', fontWeight: 600 }}>REMEDIATION AUDIT</div>
                    <div className="text-xs" style={{ marginTop: 2 }}>
                      Action: <strong className="font-mono">{selectedIncident.remediationAudit.action}</strong>
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Approved by: {selectedIncident.remediationAudit.approvedBy} at {new Date(selectedIncident.remediationAudit.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                )}

                {/* Investigation Notes & Comments */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <span className="text-xs" style={{ fontWeight: 600 }}>Investigation Notes ({selectedIncident.notes?.length || 0})</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                    {selectedIncident.notes?.map(n => (
                      <div key={n.id} className="surface" style={{ padding: 8, fontSize: '11px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10px' }}>
                          <span>{n.author}</span>
                          <span className="font-mono">{new Date(n.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div style={{ marginTop: 3 }}>{n.text}</div>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input 
                      type="text" 
                      placeholder="Add investigation note..." 
                      className="input"
                      value={newNoteText}
                      onChange={e => setNewNoteText(e.target.value)}
                    />
                    <button type="submit" className="btn btn-outline" style={{ padding: '6px 10px' }}>
                      Add
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: TELEMETRY & LOGS EXPLORER                                         */}
        {/* ========================================================================= */}
        {activeTab === 'telemetry' && (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: 16, gap: 12 }}>
            {/* Live Prometheus Metrics Gauges */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <div className="surface" style={{ padding: 12 }}>
                <div className="text-xs">Active DB Connections</div>
                <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: metricsData?.anomalies?.some(a => a.metric?.includes('connection')) ? '#f43f5e' : '#10b981' }}>
                  {metricsData?.rawMetrics?.['payment-service']?.['payment_active_connections']?.[0]?.value || 12} / 100
                </div>
                <div className="text-xs" style={{ marginTop: 2 }}>Payment Service Socket Pool</div>
              </div>

              <div className="surface" style={{ padding: 12 }}>
                <div className="text-xs">Database Connection Errors</div>
                <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: metricsData?.anomalies?.some(a => a.metric?.includes('db_errors')) ? '#f43f5e' : '#10b981' }}>
                  {metricsData?.rawMetrics?.['payment-service']?.['payment_db_errors_total']?.[0]?.value || 0}
                </div>
                <div className="text-xs" style={{ marginTop: 2 }}>Timeouts & lease drops</div>
              </div>

              <div className="surface" style={{ padding: 12 }}>
                <div className="text-xs">CPU Utilization</div>
                <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: metricsData?.anomalies?.some(a => a.metric?.includes('cpu')) ? '#f59e0b' : '#38bdf8' }}>
                  {((metricsData?.rawMetrics?.['payment-service']?.['payment_cpu_utilization_ratio']?.[0]?.value || 0.18) * 100).toFixed(1)}%
                </div>
                <div className="text-xs" style={{ marginTop: 2 }}>SLO Threshold: 80%</div>
              </div>

              <div className="surface" style={{ padding: 12 }}>
                <div className="text-xs">Downstream Cascading Errors</div>
                <div className="font-mono" style={{ fontSize: '20px', fontWeight: 700, marginTop: 4, color: metricsData?.anomalies?.some(a => a.service === 'order-service') ? '#f43f5e' : '#10b981' }}>
                  {metricsData?.rawMetrics?.['order-service']?.['order_downstream_payment_errors_total']?.[0]?.value || 0}
                </div>
                <div className="text-xs" style={{ marginTop: 2 }}>Order Service 502/504 errors</div>
              </div>
            </div>

            {/* Loki Log Stream */}
            <div className="surface" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Log Controls */}
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <select className="select" value={logFilterService} onChange={e => setLogFilterService(e.target.value)}>
                  <option value="all">All Services</option>
                  <option value="gateway-service">gateway-service</option>
                  <option value="order-service">order-service</option>
                  <option value="payment-service">payment-service</option>
                </select>

                <select className="select" value={logFilterLevel} onChange={e => setLogFilterLevel(e.target.value)}>
                  <option value="ALL">All Levels</option>
                  <option value="ERROR">ERROR</option>
                  <option value="WARN">WARN</option>
                  <option value="INFO">INFO</option>
                </select>

                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={13} style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    placeholder="Search logs by regex or keyword..." 
                    className="input" 
                    style={{ paddingLeft: 26, fontSize: '11px' }}
                    value={logSearch}
                    onChange={e => setLogSearch(e.target.value)}
                  />
                </div>

                <button 
                  className={`btn ${autoRefreshLogs ? 'btn-outline' : 'btn-subtle'}`}
                  style={{ fontSize: '11px' }}
                  onClick={() => setAutoRefreshLogs(!autoRefreshLogs)}
                >
                  {autoRefreshLogs ? 'Live Stream: ON' : 'Live Stream: PAUSED'}
                </button>
              </div>

              {/* Log Stream Output */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 10, fontFamily: 'var(--font-mono)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {filteredLogs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 30 }}>No log entries match criteria.</div>
                ) : (
                  filteredLogs.map(l => (
                    <div 
                      key={l.id} 
                      style={{ 
                        display: 'flex', gap: 10, padding: '3px 6px', borderRadius: 3,
                        background: l.level === 'ERROR' ? 'rgba(244,63,94,0.08)' : l.level === 'WARN' ? 'rgba(245,158,11,0.06)' : 'transparent',
                        color: l.level === 'ERROR' ? '#fda4af' : l.level === 'WARN' ? '#fde047' : '#cbd5e1'
                      }}
                    >
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(l.timestamp).toLocaleTimeString()}</span>
                      <span className={`badge badge-${l.level === 'ERROR' ? 'critical' : l.level === 'WARN' ? 'warning' : 'info'}`} style={{ fontSize: '8px', padding: '0 4px' }}>
                        {l.level}
                      </span>
                      <span style={{ color: '#38bdf8' }}>[{l.service}]</span>
                      <span style={{ flex: 1 }}>{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: RUNBOOKS & SOPS (CRUD)                                             */}
        {/* ========================================================================= */}
        {activeTab === 'runbooks' && (
          <div style={{ display: 'flex', width: '100%', height: '100%' }}>
            {/* Runbook Sidebar List */}
            <div style={{ width: 300, borderRight: '1px solid var(--border-subtle)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="text-heading">Indexed Runbooks ({runbooks.length})</span>
                <button className="btn btn-outline" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => setShowRunbookModal(true)}>
                  <Plus size={12} /> New SOP
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1 }}>
                {runbooks.map(rb => (
                  <div
                    key={rb.id}
                    className="surface"
                    onClick={() => setSelectedRunbook(rb)}
                    style={{
                      padding: 10, cursor: 'pointer',
                      borderLeft: selectedRunbook?.id === rb.id ? '3px solid #6366f1' : '1px solid var(--border-subtle)',
                      background: selectedRunbook?.id === rb.id ? 'rgba(99,102,241,0.06)' : 'transparent'
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{rb.title}</div>
                    <div className="text-xs" style={{ marginTop: 2 }}>ID: {rb.id}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Runbook Content Viewer */}
            <div style={{ flex: 1, padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {selectedRunbook ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
                    <div>
                      <div className="text-heading" style={{ fontSize: '16px' }}>{selectedRunbook.title}</div>
                      <div className="text-xs">Document ID: {selectedRunbook.id} • Indexed for RAG semantic matching</div>
                    </div>
                    <button className="btn btn-outline" style={{ color: '#f43f5e' }} onClick={() => handleDeleteRunbook(selectedRunbook.id)}>
                      <Trash2 size={13} /> Delete Runbook
                    </button>
                  </div>
                  <div className="surface" style={{ padding: 16, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: 1.6, color: '#e2e8f0' }}>
                    {selectedRunbook.content}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 50 }}>Select a runbook from the left to view its operating procedures.</div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: AUDIT TRAIL                                                       */}
        {/* ========================================================================= */}
        {activeTab === 'audit' && (
          <div style={{ padding: 16, width: '100%', overflowY: 'auto' }}>
            <div className="surface" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="text-heading">Remediation Action Audit Trail</div>
              <p className="text-sub">
                Complete log of human-in-the-loop approvals, executed actions, and cluster recovery states.
              </p>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Incident ID</th>
                    <th>Action Taken</th>
                    <th>Approved By</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                        No remediation actions executed yet.
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map((a, i) => (
                      <tr key={i}>
                        <td className="font-mono text-xs">{new Date(a.timestamp).toLocaleString()}</td>
                        <td className="font-mono" style={{ color: '#6366f1' }}>{a.incidentId}</td>
                        <td className="font-mono">{a.action}</td>
                        <td>{a.approvedBy}</td>
                        <td>
                          <span className="badge badge-healthy">{a.result}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ========================================================================= */}
      {/* MODAL: CREATE MANUAL INCIDENT                                            */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <span className="text-heading">Create New Incident</span>
              <button className="btn btn-subtle" style={{ padding: 4 }} onClick={() => setShowCreateModal(false)}>
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleCreateIncident}>
              <div className="modal-body">
                <div>
                  <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Incident Title</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Memory pressure on Order Worker Pod" 
                    className="input"
                    value={newIncidentForm.title}
                    onChange={e => setNewIncidentForm({ ...newIncidentForm, title: e.target.value })}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Service</label>
                    <select 
                      className="select" 
                      style={{ width: '100%' }}
                      value={newIncidentForm.service}
                      onChange={e => setNewIncidentForm({ ...newIncidentForm, service: e.target.value })}
                    >
                      <option value="gateway-service">gateway-service</option>
                      <option value="order-service">order-service</option>
                      <option value="payment-service">payment-service</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Severity</label>
                    <select 
                      className="select" 
                      style={{ width: '100%' }}
                      value={newIncidentForm.severity}
                      onChange={e => setNewIncidentForm({ ...newIncidentForm, severity: e.target.value })}
                    >
                      <option value="P1-Critical">P1-Critical</option>
                      <option value="P2-High">P2-High</option>
                      <option value="P3-Medium">P3-Medium</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Description / Initial Observations</label>
                  <textarea 
                    rows={3} 
                    className="input" 
                    placeholder="Describe observed symptoms and metrics..."
                    value={newIncidentForm.description}
                    onChange={e => setNewIncidentForm({ ...newIncidentForm, description: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Incident</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE RUNBOOK                                                     */}
      {/* ========================================================================= */}
      {showRunbookModal && (
        <div className="modal-overlay">
          <div className="modal-dialog" style={{ width: 620 }}>
            <div className="modal-header">
              <span className="text-heading">Create / Update Operational Runbook</span>
              <button className="btn btn-subtle" style={{ padding: 4 }} onClick={() => setShowRunbookModal(false)}>
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleSaveRunbook}>
              <div className="modal-body">
                <div>
                  <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Runbook Title</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Standard Operating Procedure: Redis Cache Desync" 
                    className="input"
                    value={runbookForm.title}
                    onChange={e => setRunbookForm({ ...runbookForm, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Runbook ID (Filename)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. redis_cache_desync" 
                    className="input font-mono"
                    value={runbookForm.id}
                    onChange={e => setRunbookForm({ ...runbookForm, id: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>Markdown Content (SOP Procedures)</label>
                  <textarea 
                    rows={8} 
                    required
                    className="input font-mono" 
                    placeholder="## Symptoms&#10;- Error alerts...&#10;&#10;## Remediation Steps&#10;1. Flush cache..."
                    value={runbookForm.content}
                    onChange={e => setRunbookForm({ ...runbookForm, content: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowRunbookModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save & Index Runbook</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: SETTINGS & GEMINI CONFIGURATION                                   */}
      {/* ========================================================================= */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <span className="text-heading" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings size={14} />
                AIOps Engine Settings
              </span>
              <button className="btn btn-subtle" style={{ padding: 4 }} onClick={() => setShowSettings(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div>
                <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>
                  Google Gemini API Key
                </label>
                <input 
                  type="password" 
                  placeholder={settingsStatus?.hasKey ? `Configured (${settingsStatus.maskedKey})` : "Enter AI Studio API Key..."} 
                  className="input font-mono"
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                />
                <span className="text-xs" style={{ display: 'block', marginTop: 4 }}>
                  Keys are saved persistently to <code className="font-mono">data/settings.json</code>. Built-in semantic fallback guarantees 100% offline availability.
                </span>
              </div>

              <div>
                <label className="text-xs" style={{ display: 'block', marginBottom: 4 }}>
                  Gemini Model Selection
                </label>
                <select 
                  className="select" 
                  style={{ width: '100%' }}
                  value={geminiModel}
                  onChange={e => setGeminiModel(e.target.value)}
                >
                  <option value="gemini-2.0-flash">gemini-2.0-flash (Fast & Structured)</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setShowSettings(false)}>Close</button>
              <button className="btn btn-primary" onClick={handleSaveSettings}>Save Configuration</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
