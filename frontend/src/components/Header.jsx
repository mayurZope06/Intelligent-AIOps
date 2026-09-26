import React from 'react';
import { 
  Activity, Layers, AlertCircle, Terminal, BookOpen, 
  History, Settings, Cpu, RefreshCw 
} from 'lucide-react';
import BrandLogo from './BrandLogo';

export default function Header({
  activeTab,
  setActiveTab,
  openIncidentsCount,
  hasCriticalIncident,
  clusterStatus = 'NOMINAL',
  telemetryStatus = 'NOMINAL',
  prometheusConnected,
  isAnalyzing,
  onRunAiDiagnosis,
  onOpenSettings,
  activeScenario,
  onSelectScenario
}) {
  return (
    <header className="app-header">
      {/* Brand & Identity */}
      <div className="brand-section">
        <BrandLogo size={32} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="brand-title">Intelligent AIOps</span>
          <span className="brand-badge">Enterprise v1.0</span>
        </div>
      </div>

      {/* Apple-Style Segmented Navigation */}
      <nav className="segmented-control">
        <button 
          className={`segmented-item ${activeTab === 'topology' ? 'active' : ''}`}
          onClick={() => setActiveTab('topology')}
        >
          <Layers size={13} strokeWidth={2} />
          <span>Topology</span>
        </button>

        <button 
          className={`segmented-item ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          <AlertCircle size={13} strokeWidth={2} />
          <span>Incidents</span>
          {openIncidentsCount > 0 && (
            <span className="segmented-badge">{openIncidentsCount}</span>
          )}
        </button>

        <button 
          className={`segmented-item ${activeTab === 'telemetry' ? 'active' : ''}`}
          onClick={() => setActiveTab('telemetry')}
        >
          <Terminal size={13} strokeWidth={2} />
          <span>Telemetry</span>
        </button>

        <button 
          className={`segmented-item ${activeTab === 'runbooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('runbooks')}
        >
          <BookOpen size={13} strokeWidth={2} />
          <span>Runbooks</span>
        </button>

        <button 
          className={`segmented-item ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <History size={13} strokeWidth={2} />
          <span>Audit Trail</span>
        </button>
      </nav>

      {/* Global Status & Quick Actions */}
      <div className="header-actions">
        {/* Dynamic Cluster Health State */}
        <div 
          className="system-status-pill" 
          title={`Cluster Health: ${clusterStatus} (derived from live service telemetry)`}
        >
          <span className={`status-dot ${
            clusterStatus === 'CRITICAL' ? 'status-dot-critical' :
            clusterStatus === 'DEGRADED' ? 'status-dot-warning' :
            clusterStatus === 'OFFLINE' ? 'status-dot-offline' :
            'status-dot-healthy'
          }`} />
          <span>
            {clusterStatus === 'CRITICAL' ? 'Cluster Critical' :
             clusterStatus === 'DEGRADED' ? 'Cluster Degraded' :
             clusterStatus === 'OFFLINE' ? 'Cluster Offline' :
             'Cluster Nominal'}
          </span>
        </div>

        {/* Dynamic Telemetry Status */}
        <div 
          className="system-status-pill" 
          title={prometheusConnected 
            ? 'Prometheus Telemetry Scraper Active (:9090)' 
            : 'Direct Service Probing Active (Prometheus Server Unreachable)'}
        >
          <span className={`status-dot ${
            telemetryStatus === 'OFFLINE' ? 'status-dot-offline' :
            telemetryStatus === 'ANOMALY' ? 'status-dot-warning' :
            'status-dot-healthy'
          }`} />
          <span>
            {telemetryStatus === 'OFFLINE' ? 'Telemetry Offline' :
             telemetryStatus === 'ANOMALY' ? 'Telemetry Anomaly' :
             (prometheusConnected ? 'Prometheus: Live' : 'Probes: Live')}
          </span>
        </div>

        {/* Test Scenario Simulator */}
        <select
          className="apple-select"
          style={{ width: 280, fontSize: '11px', padding: '4px 8px' }}
          value={activeScenario || 'none'}
          onChange={(e) => onSelectScenario && onSelectScenario(e.target.value)}
          title="Inject real test anomalies into the cluster telemetry pipeline"
        >
          <option value="none">Telemetry: Nominal (All Healthy)</option>
          <option value="gateway_outage">Simulate: API Gateway 502 Outage (API Gateway)</option>
          <option value="cache_stampede">Simulate: Ingress Cache Storm (API Gateway)</option>
          <option value="order_deadlock">Simulate: Order Circuit Breaker Trip (Order Service)</option>
          <option value="auth_storm">Simulate: Auth Token Storm & 401 Burst (Auth Service)</option>
          <option value="inventory_lock">Simulate: Inventory Deadlock & Depletion (Inventory)</option>
          <option value="payment_gateway_down">Simulate: 3rd-Party Gateway 503 (Payment Service)</option>
          <option value="high_cpu">Simulate: High CPU & Event Loop (Payment Service)</option>
          <option value="db_overload">Simulate: DB Pool Exhaustion (MongoDB Cluster)</option>
        </select>

        {/* AI Diagnosis Action */}
        <button 
          className="apple-btn apple-btn-secondary"
          onClick={() => onRunAiDiagnosis()}
          disabled={isAnalyzing}
          title="Correlate multi-source telemetry and invoke Google Gemini RCA"
        >
          {isAnalyzing ? (
            <RefreshCw size={13} className="spin" />
          ) : (
            <Cpu size={13} color="#64d2ff" />
          )}
          <span>{isAnalyzing ? 'Analyzing...' : 'Diagnose'}</span>
        </button>

        {/* Settings Modal Toggle */}
        <button 
          className="apple-btn apple-btn-subtle apple-btn-icon"
          onClick={onOpenSettings}
          title="Engine Configuration (Gemini API & Telemetry Endpoints)"
        >
          <Settings size={15} />
        </button>
      </div>
    </header>
  );
}
