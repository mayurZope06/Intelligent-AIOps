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
import ToastContainer from './components/ToastContainer';
import AsyncProgressHUD from './components/AsyncProgressHUD';

const API_BASE = 'http://localhost:5000/api';

const DEFAULT_NODES = [
  {
    id: 'frontend',
    type: 'serviceNode',
    position: { x: 50, y: 220 },
    data: { id: 'frontend', name: 'Client / Web Frontend', status: 'HEALTHY', port: 5173, team: 'Frontend Platform', type: 'client' }
  },
  {
    id: 'gateway-service',
    type: 'serviceNode',
    position: { x: 300, y: 220 },
    data: { id: 'gateway-service', name: 'API Gateway', status: 'HEALTHY', port: 4000, team: 'Core Infrastructure', type: 'gateway' }
  },
  {
    id: 'auth-service',
    type: 'serviceNode',
    position: { x: 560, y: 100 },
    data: { id: 'auth-service', name: 'Auth & IAM Service', status: 'HEALTHY', port: 4003, team: 'Security & IAM', type: 'service' }
  },
  {
    id: 'order-service',
    type: 'serviceNode',
    position: { x: 560, y: 280 },
    data: { id: 'order-service', name: 'Order Service', status: 'HEALTHY', port: 4001, team: 'Commerce Team', type: 'service' }
  },
  {
    id: 'inventory-service',
    type: 'serviceNode',
    position: { x: 820, y: 180 },
    data: { id: 'inventory-service', name: 'Inventory Service', status: 'HEALTHY', port: 4004, team: 'Logistics Team', type: 'service' }
  },
  {
    id: 'payment-service',
    type: 'serviceNode',
    position: { x: 820, y: 380 },
    data: { id: 'payment-service', name: 'Payment Service', status: 'HEALTHY', port: 4002, team: 'Fintech Team', type: 'service' }
  },
  {
    id: 'database',
    type: 'serviceNode',
    position: { x: 1080, y: 380 },
    data: { id: 'database', name: 'MongoDB Cluster', status: 'HEALTHY', port: 27017, team: 'Database Ops', type: 'database' }
  }
];

const DEFAULT_EDGES = [
  { id: 'e-client-gw', source: 'frontend', target: 'gateway-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 1.5 } },
  { id: 'e-gw-auth', source: 'gateway-service', target: 'auth-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 1.5 } },
  { id: 'e-gw-order', source: 'gateway-service', target: 'order-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 1.5 } },
  { id: 'e-order-inv', source: 'order-service', target: 'inventory-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 1.5 } },
  { id: 'e-order-payment', source: 'order-service', target: 'payment-service', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 1.5 } },
  { id: 'e-payment-db', source: 'payment-service', target: 'database', animated: true, style: { stroke: 'rgba(255, 255, 255, 0.25)', strokeWidth: 1.5 } }
];

export default function App() {
  // Navigation: 'topology' | 'incidents' | 'telemetry' | 'runbooks' | 'audit'
  const [activeTab, setActiveTab] = useState('topology');

  // Topology State (initialized with default architecture)
  const [nodes, setNodes] = useState(DEFAULT_NODES);
  const [edges, setEdges] = useState(DEFAULT_EDGES);
  const [selectedNode, setSelectedNode] = useState(null);
  const [clusterStatus, setClusterStatus] = useState('NOMINAL');
  const [telemetryStatus, setTelemetryStatus] = useState('NOMINAL');

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
  const [asyncActionStatus, setAsyncActionStatus] = useState(null);

  // Professional Apple Toast Notifications State
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message, type = 'info', title = null) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    setToasts(prev => [...prev, { id, message, type, title }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // 1. Fetch Topology Graph (Derived from live telemetry and actual downstream request failures)
  const fetchGraph = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/graph`);
      const rawNodes = res.data.nodes || [];
      const rawEdges = res.data.edges || [];

      if (res.data.clusterStatus) setClusterStatus(res.data.clusterStatus);
      if (res.data.telemetryStatus) setTelemetryStatus(res.data.telemetryStatus);
      if (res.data.prometheusConnected !== undefined) setPrometheusConnected(res.data.prometheusConnected);

      const positions = {
        'frontend': { x: 50, y: 220 },
        'gateway-service': { x: 300, y: 220 },
        'auth-service': { x: 560, y: 100 },
        'order-service': { x: 560, y: 280 },
        'inventory-service': { x: 820, y: 180 },
        'payment-service': { x: 820, y: 380 },
        'database': { x: 1080, y: 380 }
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

      // Dependency edges display affected request paths separately from individual node health
      const flowEdges = rawEdges.map(e => {
        const isAffected = e.isAffectedPath || e.status === 'AFFECTED';
        const isCritical = e.severity === 'CRITICAL';
        const isDegraded = e.severity === 'DEGRADED';

        let strokeColor = 'rgba(255, 255, 255, 0.25)';
        if (isAffected) {
          if (isCritical) {
            strokeColor = '#ff453a';
          } else if (isDegraded) {
            strokeColor = '#ff9f0a';
          }
        }

        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: true,
          style: {
            stroke: strokeColor,
            strokeWidth: isAffected ? 2.5 : 1.5,
            strokeDasharray: isAffected ? '5 5' : undefined
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isAffected ? strokeColor : 'rgba(255, 255, 255, 0.4)'
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

  // Select Anomaly Simulation Scenario (Real Asynchronous Microservice Dispatch & Prometheus Verification)
  const handleSelectScenario = async (scenario) => {
    setActiveScenario(scenario);

    if (scenario === 'none' || scenario === 'reset') {
      setAsyncActionStatus({
        type: 'inject',
        phase: 'dispatching',
        title: 'Restoring Cluster Baseline...',
        message: 'Clearing faults across all microservices and resetting error counters...'
      });

      try {
        const res = await axios.post(`${API_BASE}/scenarios/inject`, { scenario: 'none' });
        await Promise.all([fetchGraph(), fetchTelemetry(), fetchIncidents()]);

        if (res.data?.verified) {
          setAsyncActionStatus({
            type: 'inject',
            phase: 'verified',
            title: 'Cluster Nominal & Verified',
            message: 'Prometheus confirms 0 anomalies across all services. Cluster is HEALTHY.'
          });
          addToast('Cluster nominal. Prometheus telemetry confirms all services healthy.', 'success', 'Cluster Healthy');
        } else {
          setAsyncActionStatus({
            type: 'inject',
            phase: 'awaiting_prometheus',
            title: 'Awaiting Prometheus Sync',
            message: 'All faults cleared on microservices. Awaiting next scrape cycle...'
          });
        }
      } catch (err) {
        setAsyncActionStatus({
          type: 'inject',
          phase: 'failed',
          title: 'Reset Failed',
          message: err.response?.data?.details || err.message
        });
      } finally {
        setTimeout(() => setAsyncActionStatus(null), 4000);
      }
      return;
    }

    // A specific fault scenario chosen
    setAsyncActionStatus({
      type: 'inject',
      phase: 'dispatching',
      title: 'Injecting Fault...',
      message: `Dispatching fault scenario '${scenario}' to target microservice...`
    });

    // Step 2 indicator while waiting for the request to return (backend is polling Prometheus)
    const timeoutIndicator = setTimeout(() => {
      setAsyncActionStatus(prev => prev ? {
        ...prev,
        phase: 'awaiting_prometheus',
        title: 'Waiting for Prometheus...',
        message: 'Microservice entered degraded state. Waiting for Prometheus to observe changed telemetry...'
      } : null);
    }, 1200);

    try {
      const res = await axios.post(`${API_BASE}/scenarios/inject`, { scenario });
      clearTimeout(timeoutIndicator);

      await Promise.all([
        fetchGraph(),
        fetchTelemetry(),
        fetchIncidents()
      ]);

      if (res.data?.verified) {
        setAsyncActionStatus({
          type: 'inject',
          phase: 'verified',
          title: 'Failure Detected & Verified',
          message: res.data.message || `Prometheus verified anomalous telemetry on ${res.data.service}. Incident declared.`
        });

        if (res.data.incident) {
          setSelectedIncident(res.data.incident);
        }
      } else {
        setAsyncActionStatus({
          type: 'inject',
          phase: 'unverified',
          title: 'Detection In Progress',
          message: res.data.message || 'Fault accepted by microservice, awaiting Prometheus telemetry scrape...'
        });
      }
    } catch (err) {
      clearTimeout(timeoutIndicator);
      setAsyncActionStatus({
        type: 'inject',
        phase: 'failed',
        title: 'Fault Injection Failed',
        message: err.response?.data?.details || err.message
      });
      addToast(err.response?.data?.details || err.message, 'error', 'Injection Error');
    } finally {
      setTimeout(() => setAsyncActionStatus(null), 5000);
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
        addToast('Cluster nominal. No anomalous telemetry detected across microservices.', 'info', 'Cluster Nominal');
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
      addToast(err.response?.data?.error || err.message, 'error', 'AI Diagnosis Error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Human-in-the-Loop Remediation Approval (Real Execution & Verification)
  const handleApproveRemediation = async (incidentId, actionType) => {
    setRemediating(true);
    setAsyncActionStatus({
      type: 'remediate',
      phase: 'dispatching',
      title: 'Remediation In Progress...',
      message: `Executing real runbook action '${actionType || 'restart_service'}' on affected service...`
    });

    const timeoutIndicator = setTimeout(() => {
      setAsyncActionStatus(prev => prev ? {
        ...prev,
        phase: 'awaiting_prometheus',
        title: 'Verifying with Prometheus...',
        message: 'Remediation action executed. Re-querying Prometheus and service health until recovery is confirmed...'
      } : null);
    }, 1500);

    try {
      const res = await axios.post(`${API_BASE}/remediation/approve`, {
        incidentId,
        action: actionType || 'restart_service',
        operatorName: 'DevOps SRE Lead'
      });
      clearTimeout(timeoutIndicator);

      // Refresh graph, incidents, telemetry, and audit based on real telemetry post-remediation
      await Promise.all([
        fetchGraph(),
        fetchIncidents(),
        fetchTelemetry(),
        fetchAudit()
      ]);

      if (res.data?.recovered) {
        setActiveScenario('none');
        setShowRcaModal(false);
        setAsyncActionStatus({
          type: 'remediate',
          phase: 'verified',
          title: 'Remediation Verified Successful!',
          message: res.data.message || 'Prometheus confirmed 0 active anomalies. Service returned to HEALTHY.'
        });
      } else {
        setAsyncActionStatus({
          type: 'remediate',
          phase: 'unverified',
          title: 'Remediation Unverified — Still Failing',
          message: res.data?.message || 'Remediation executed, but Prometheus telemetry confirms service is STILL FAILING.'
        });
      }
    } catch (err) {
      clearTimeout(timeoutIndicator);
      setAsyncActionStatus({
        type: 'remediate',
        phase: 'failed',
        title: 'Remediation Failed',
        message: err.response?.data?.details || err.message
      });
      addToast(err.response?.data?.details || err.message, 'error', 'Remediation Failed');
    } finally {
      setRemediating(false);
      setTimeout(() => setAsyncActionStatus(null), 5000);
    }
  };

  // Incident Operations
  const handleCreateIncident = async (newIncidentData) => {
    try {
      const res = await axios.post(`${API_BASE}/incidents`, newIncidentData);
      fetchIncidents();
      setSelectedIncident(res.data);
      addToast('Incident registered in cluster incident queue.', 'success', 'Incident Declared');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Create Incident');
    }
  };

  const handleUpdateStatus = async (id, status) => {
    try {
      const res = await axios.patch(`${API_BASE}/incidents/${id}`, { status });
      fetchIncidents();
      setSelectedIncident(res.data);
      addToast(`Incident status updated to ${status}.`, 'info', 'Status Updated');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Update Status');
    }
  };

  const handleDeleteIncident = async (id) => {
    if (!confirm(`Permanently delete incident ${id}?`)) return;
    try {
      await axios.delete(`${API_BASE}/incidents/${id}`);
      fetchIncidents();
      if (selectedIncident?.id === id) setSelectedIncident(null);
      addToast('Incident record permanently deleted.', 'info', 'Incident Deleted');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Delete Incident');
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
      addToast('Note appended to incident timeline.', 'success', 'Note Added');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Add Note');
    }
  };

  // Runbook Operations
  const handleSaveRunbook = async (runbookData) => {
    try {
      await axios.post(`${API_BASE}/rag/runbooks`, runbookData);
      fetchRunbooks();
      setSelectedRunbook(runbookData);
      addToast('Standard operating procedure saved and indexed in RAG store.', 'success', 'Runbook Saved');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Save Runbook');
    }
  };

  const handleDeleteRunbook = async (id) => {
    if (!confirm(`Delete runbook ${id}?`)) return;
    try {
      await axios.delete(`${API_BASE}/rag/runbooks/${id}`);
      fetchRunbooks();
      setSelectedRunbook(null);
      addToast('Runbook deleted from operational library.', 'info', 'Runbook Removed');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Delete Runbook');
    }
  };

  // Settings Save
  const handleSaveSettings = async (settings) => {
    try {
      const res = await axios.post(`${API_BASE}/config/settings`, settings);
      setSettingsStatus(res.data);
      addToast('Configuration settings updated successfully.', 'success', 'Settings Saved');
    } catch (err) {
      addToast(err.message, 'error', 'Failed to Save Settings');
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
        clusterStatus={clusterStatus}
        telemetryStatus={telemetryStatus}
        prometheusConnected={prometheusConnected}
        isAnalyzing={isAnalyzing}
        onRunAiDiagnosis={handleRunAiDiagnosis}
        onOpenSettings={() => setShowSettings(true)}
        activeScenario={activeScenario}
        onSelectScenario={handleSelectScenario}
      />

      {/* Asynchronous Operation Progress & Telemetry Verification HUD */}
      <AsyncProgressHUD 
        status={asyncActionStatus} 
        onDismiss={() => setAsyncActionStatus(null)} 
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

      {/* Luxury Apple-style Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
