import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { MarkerType } from 'reactflow';

// Modular Apple-style Components
import Header from './components/Header';
import TopologyView from './components/TopologyView';
import IncidentsView from './components/IncidentsView';
import TelemetryView from './components/TelemetryView';
import RunbooksView from './components/RunbooksView';
import AuditView from './components/AuditView';
import SettingsModal from './components/SettingsModal';
import RCAModal from './components/RCAModal';

const API_BASE = 'http://localhost:5000/api';

const DEFAULT_NODES = [
  {
    id: 'frontend',
    type: 'serviceNode',
    position: { x: 60, y: 220 },
    data: { id: 'frontend', name: 'Client / Web Frontend', status: 'HEALTHY', port: 5173, team: 'Frontend Platform', type: 'client' }
  },
  {
    id: 'gateway-service',
    type: 'serviceNode',
    position: { x: 325, y: 220 },
    data: { id: 'gateway-service', name: 'API Gateway', status: 'HEALTHY', port: 4000, team: 'Core Infrastructure', type: 'gateway' }
  },
  {
    id: 'order-service',
    type: 'serviceNode',
    position: { x: 590, y: 220 },
    data: { id: 'order-service', name: 'Order Service', status: 'HEALTHY', port: 4001, team: 'Commerce Team', type: 'service' }
  },
  {
    id: 'payment-service',
    type: 'serviceNode',
    position: { x: 855, y: 220 },
    data: { id: 'payment-service', name: 'Payment Service', status: 'HEALTHY', port: 4002, team: 'Fintech Team', type: 'service' }
  },
  {
    id: 'database',
    type: 'serviceNode',
    position: { x: 1120, y: 220 },
    data: { id: 'database', name: 'MongoDB Cluster', status: 'HEALTHY', port: 27017, team: 'Database Ops', type: 'database' }
  }
];

const DEFAULT_EDGES = [
  { id: 'e-client-gw', source: 'frontend', target: 'gateway-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1 } },
  { id: 'e-gw-order', source: 'gateway-service', target: 'order-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1 } },
  { id: 'e-order-payment', source: 'order-service', target: 'payment-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1 } },
  { id: 'e-payment-db', source: 'payment-service', target: 'database', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.2)', strokeWidth: 1 } }
];

export default function App() {
  // Navigation: 'topology' | 'incidents' | 'telemetry' | 'runbooks' | 'audit'
  const [activeTab, setActiveTab] = useState('topology');

  // Topology State (initialized with default architecture)
  const [nodes, setNodes] = useState(DEFAULT_NODES);
  const [edges, setEdges] = useState(DEFAULT_EDGES);
  const [selectedNode, setSelectedNode] = useState(null);

  // Incidents State
  const [incidents, setIncidents] = useState([]);
  const [incidentMetrics, setIncidentMetrics] = useState({
    totalIncidents: 0,
    openIncidents: 0,
    resolvedIncidents: 0,
    averageMTTRSeconds: 0
  });
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [incidentFilterStatus, setIncidentFilterStatus] = useState('ALL');
  const [incidentFilterSeverity, setIncidentFilterSeverity] = useState('ALL');
  const [incidentSearch, setIncidentSearch] = useState('');

  // Telemetry & Logs State
  const [metricsData, setMetricsData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logFilterService, setLogFilterService] = useState('all');
  const [logFilterLevel, setLogFilterLevel] = useState('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(true);

  // Runbooks State
  const [runbooks, setRunbooks] = useState([]);
  const [selectedRunbook, setSelectedRunbook] = useState(null);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState([]);

  // AI Analysis & RCA State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [latestRcaReport, setLatestRcaReport] = useState(null);
  const [showRcaModal, setShowRcaModal] = useState(false);
  const [remediating, setRemediating] = useState(false);

  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState(null);

  // Connectivity & Test Scenarios
  const [prometheusConnected, setPrometheusConnected] = useState(false);
  const [activeScenario, setActiveScenario] = useState('none');

  // 1. Fetch Topology Graph
  const fetchGraph = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/graph`);
      const rawNodes = res.data.nodes || [];
      const rawEdges = res.data.edges || [];

      const positions = {
        'frontend': { x: 60, y: 220 },
        'gateway-service': { x: 325, y: 220 },
        'order-service': { x: 590, y: 220 },
        'payment-service': { x: 855, y: 220 },
        'database': { x: 1120, y: 220 }
      };

      const flowNodes = rawNodes.map(n => ({
        id: n.id,
        type: 'serviceNode',
        position: positions[n.id] || { x: 100, y: 100 },
        data: {
          id: n.id,
          name: n.name,
          status: n.status,
          port: n.port,
          team: n.team,
          type: n.type,
          anomalies: n.anomalies,
          serviceInfo: n.serviceInfo
        }
      }));

      const flowEdges = rawEdges.map(e => {
        const sourceNode = flowNodes.find(n => n.id === e.source);
        const targetNode = flowNodes.find(n => n.id === e.target);
        
        const isCritical = sourceNode?.data?.status === 'CRITICAL' || targetNode?.data?.status === 'CRITICAL';
        const isDegraded = sourceNode?.data?.status === 'DEGRADED' || targetNode?.data?.status === 'DEGRADED';
        const isOffline = sourceNode?.data?.status === 'OFFLINE' || targetNode?.data?.status === 'OFFLINE';
        const isFailing = isCritical || isDegraded || isOffline;

        let strokeColor = 'rgba(255, 255, 255, 0.25)';
        if (isCritical || isOffline) {
          strokeColor = '#ff453a';
        } else if (isDegraded) {
          strokeColor = '#ff9f0a';
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: true,
          style: {
            stroke: strokeColor,
            strokeWidth: isFailing ? 2.5 : 1,
            strokeDasharray: isFailing ? '5 5' : undefined
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isFailing ? strokeColor : 'rgba(255, 255, 255, 0.4)'
          }
        };
      });

      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (err) {
      console.error('Failed to load topology:', err);
    }
  }, []);

  // 2. Fetch Incidents
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
          params: { service: logFilterService, level: logFilterLevel, limit: 80 }
        })
      ]);
      setMetricsData(mRes.data);
      setPrometheusConnected(mRes.data?.prometheusConnected || false);
      setLogs(lRes.data || []);
    } catch (err) {
      console.error('Telemetry fetch failed:', err);
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
    } catch (err) {
      console.error('Runbooks fetch failed:', err);
    }
  }, [selectedRunbook]);

  // 5. Fetch Audit Trail
  const fetchAudit = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/remediation/audit`);
      setAuditLogs(res.data || []);
    } catch (err) {
      console.error('Audit fetch failed:', err);
    }
  }, []);

  // 6. Fetch Settings
  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/config/settings`);
      setSettingsStatus(res.data);
    } catch (err) {
      console.error('Settings fetch failed:', err);
    }
  }, []);

  // Polling loop (every 3 seconds)
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

  // Select Anomaly Simulation Scenario
  const handleSelectScenario = async (scenario) => {
    setActiveScenario(scenario);
    try {
      await axios.post(`${API_BASE}/telemetry/simulate`, { scenario });
      await Promise.all([
        fetchGraph(),
        fetchTelemetry(),
        fetchIncidents()
      ]);
    } catch (err) {
      console.error('Failed to update test scenario:', err);
    }
  };

  // Trigger AI Diagnosis (supports specific incident or active cluster state)
  const handleRunAiDiagnosis = async (specificIncidentId) => {
    setIsAnalyzing(true);
    try {
      // Guard: only accept a real string incident ID, not a React event object
      const idToUse = (specificIncidentId && typeof specificIncidentId === 'string')
        ? specificIncidentId
        : (selectedIncident ? selectedIncident.id : null);
      const payload = idToUse ? { incidentId: idToUse } : {};
      const res = await axios.post(`${API_BASE}/analyze`, payload);
      
      if (res.data.status === 'OK') {
        alert('Cluster nominal. No anomalous telemetry detected across services.');
      } else {
        setLatestRcaReport({
          ...res.data.analysis,
          incidentId: res.data.incidentId || idToUse
        });
        setShowRcaModal(true);
        fetchIncidents();
        fetchGraph();
        if (res.data.incidentId && (!selectedIncident || selectedIncident.id !== res.data.incidentId)) {
          const incRes = await axios.get(`${API_BASE}/incidents/${res.data.incidentId}`).catch(() => null);
          if (incRes) setSelectedIncident(incRes.data);
        }
      }
    } catch (err) {
      alert(`AI Diagnosis Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Human-in-the-Loop Remediation Approval
  const handleApproveRemediation = async (incidentId, actionType) => {
    setRemediating(true);
    try {
      await axios.post(`${API_BASE}/remediation/approve`, {
        incidentId,
        action: actionType || 'restart_service',
        operatorName: 'DevOps SRE Lead'
      });
      setActiveScenario('none');
      await Promise.all([
        fetchGraph(),
        fetchIncidents(),
        fetchTelemetry(),
        fetchAudit()
      ]);
      setShowRcaModal(false);
      alert('Remediation action successfully approved and executed. Dependency graph and cluster state restored to HEALTHY.');
    } catch (err) {
      alert(`Remediation failed: ${err.message}`);
    } finally {
      setRemediating(false);
    }
  };

  // Incident Operations
  const handleCreateIncident = async (newIncidentData) => {
    try {
      const res = await axios.post(`${API_BASE}/incidents`, newIncidentData);
      fetchIncidents();
      setSelectedIncident(res.data);
    } catch (err) {
      alert(`Failed to create incident: ${err.message}`);
    }
  };

  const handleUpdateStatus = async (id, status) => {
    try {
      const res = await axios.patch(`${API_BASE}/incidents/${id}`, { status });
      fetchIncidents();
      setSelectedIncident(res.data);
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleDeleteIncident = async (id) => {
    if (!confirm(`Permanently delete incident ${id}?`)) return;
    try {
      await axios.delete(`${API_BASE}/incidents/${id}`);
      fetchIncidents();
      if (selectedIncident?.id === id) setSelectedIncident(null);
    } catch (err) {
      alert(`Failed to delete incident: ${err.message}`);
    }
  };

  const handleAddNote = async (id, noteText) => {
    try {
      await axios.post(`${API_BASE}/incidents/${id}/notes`, {
        author: 'SRE On-Call',
        text: noteText
      });
      const res = await axios.get(`${API_BASE}/incidents/${id}`);
      setSelectedIncident(res.data);
      fetchIncidents();
    } catch (err) {
      alert(`Failed to add note: ${err.message}`);
    }
  };

  // Runbook Operations
  const handleSaveRunbook = async (runbookData) => {
    try {
      await axios.post(`${API_BASE}/rag/runbooks`, runbookData);
      fetchRunbooks();
      setSelectedRunbook(runbookData);
    } catch (err) {
      alert(`Failed to save runbook: ${err.message}`);
    }
  };

  const handleDeleteRunbook = async (id) => {
    if (!confirm(`Delete runbook ${id}?`)) return;
    try {
      await axios.delete(`${API_BASE}/rag/runbooks/${id}`);
      fetchRunbooks();
      setSelectedRunbook(null);
    } catch (err) {
      alert(`Failed to delete runbook: ${err.message}`);
    }
  };

  // Settings Save
  const handleSaveSettings = async (settings) => {
    try {
      const res = await axios.post(`${API_BASE}/config/settings`, settings);
      setSettingsStatus(res.data);
    } catch (err) {
      alert(`Failed to save settings: ${err.message}`);
    }
  };

  const hasCriticalIncident = incidents.some(i => i.severity === 'P1-Critical' && i.status !== 'RESOLVED');

  return (
    <div className="app-container">
      {/* Apple-Style Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openIncidentsCount={incidentMetrics.openIncidents}
        hasCriticalIncident={hasCriticalIncident}
        prometheusConnected={prometheusConnected}
        isAnalyzing={isAnalyzing}
        onRunAiDiagnosis={handleRunAiDiagnosis}
        onOpenSettings={() => setShowSettings(true)}
        activeScenario={activeScenario}
        onSelectScenario={handleSelectScenario}
      />

      {/* Main Operational View Switcher */}
      <main className="app-main">
        {activeTab === 'topology' && (
          <TopologyView
            nodes={nodes}
            edges={edges}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
          />
        )}

        {activeTab === 'incidents' && (
          <IncidentsView
            incidents={incidents}
            incidentMetrics={incidentMetrics}
            selectedIncident={selectedIncident}
            onSelectIncident={setSelectedIncident}
            onCreateIncident={handleCreateIncident}
            onUpdateStatus={handleUpdateStatus}
            onDeleteIncident={handleDeleteIncident}
            onAddNote={handleAddNote}
            onDiagnoseIncident={handleRunAiDiagnosis}
            statusFilter={incidentFilterStatus}
            setStatusFilter={setIncidentFilterStatus}
            severityFilter={incidentFilterSeverity}
            setSeverityFilter={setIncidentFilterSeverity}
            searchQuery={incidentSearch}
            setSearchQuery={setIncidentSearch}
          />
        )}

        {activeTab === 'telemetry' && (
          <TelemetryView
            metricsData={metricsData}
            logs={logs}
            onRefresh={fetchTelemetry}
            autoRefresh={autoRefreshLogs}
            onToggleAutoRefresh={() => setAutoRefreshLogs(!autoRefreshLogs)}
            logFilterService={logFilterService}
            setLogFilterService={setLogFilterService}
            logFilterLevel={logFilterLevel}
            setLogFilterLevel={setLogFilterLevel}
            logSearch={logSearch}
            setLogSearch={setLogSearch}
          />
        )}

        {activeTab === 'runbooks' && (
          <RunbooksView
            runbooks={runbooks}
            selectedRunbook={selectedRunbook}
            onSelectRunbook={setSelectedRunbook}
            onSaveRunbook={handleSaveRunbook}
            onDeleteRunbook={handleDeleteRunbook}
          />
        )}

        {activeTab === 'audit' && (
          <AuditView
            auditLogs={auditLogs}
          />
        )}
      </main>

      {/* AI Root Cause Analysis Modal */}
      <RCAModal
        isOpen={showRcaModal}
        onClose={() => setShowRcaModal(false)}
        rcaReport={latestRcaReport}
        onApproveRemediation={handleApproveRemediation}
        remediating={remediating}
      />

      {/* Engine Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settingsStatus={settingsStatus}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
}
