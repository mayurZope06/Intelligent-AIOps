import React, { useState } from 'react';
import { Terminal, Activity, RefreshCw, Search, Filter, Server, CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react';

export default function TelemetryView({
  metricsData,
  logs,
  onRefresh,
  autoRefresh,
  onToggleAutoRefresh,
  logFilterService,
  setLogFilterService,
  logFilterLevel,
  setLogFilterLevel,
  logSearch,
  setLogSearch
}) {
  const [activeSubTab, setActiveSubTab] = useState('metrics'); // 'metrics' | 'logs'

  const services = metricsData?.services || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '24px 28px', overflowY: 'auto', gap: 20 }}>
      {/* Telemetry Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="segmented-control">
            <button
              className={`segmented-item ${activeSubTab === 'metrics' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('metrics')}
            >
              <Activity size={13} />
              <span>Metrics & Probes</span>
            </button>
            <button
              className={`segmented-item ${activeSubTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('logs')}
            >
              <Terminal size={13} />
              <span>Log Streams ({logs.length})</span>
            </button>
          </div>

          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
            Source: {metricsData?.source || 'live-telemetry'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button 
            className={`apple-btn ${autoRefresh ? 'apple-btn-secondary' : 'apple-btn-subtle'}`}
            onClick={onToggleAutoRefresh}
            style={{ fontSize: '11px' }}
          >
            <span className={`status-dot ${autoRefresh ? 'status-dot-healthy' : 'status-dot-offline'}`} />
            <span>{autoRefresh ? 'Live Polling (3s)' : 'Polling Paused'}</span>
          </button>

          <button className="apple-btn apple-btn-secondary apple-btn-icon" onClick={onRefresh} title="Scrape now">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* SUB-VIEW 1: METRICS & SCRAPE TARGETS */}
      {activeSubTab === 'metrics' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Target Health Cards */}
          <div>
            <div className="section-title">Telemetry Scrape Targets</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {Object.entries(services).map(([svc, info]) => {
                const isOnline = info.status === 'ONLINE';
                return (
                  <div key={svc} className="apple-card" style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{svc}</span>
                      <span className={`status-pill ${isOnline ? 'status-pill-healthy' : 'status-pill-neutral'}`}>
                        {info.status}
                      </span>
                    </div>

                    <div className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: 6 }}>
                      {info.endpoint}
                    </div>

                    {info.error && (
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', background: 'rgba(255, 255, 255, 0.02)', padding: '6px 8px', borderRadius: 4 }}>
                        {info.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Prometheus Anomalies */}
          <div>
            <div className="section-title">Detected Metric Anomalies ({metricsData?.anomalies?.length || 0})</div>
            {(!metricsData?.anomalies || metricsData.anomalies.length === 0) ? (
              <div className="apple-card" style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <CheckCircle2 size={28} color="#30d158" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>No Anomalous Metrics Detected</div>
                <div style={{ fontSize: '11px', marginTop: 2 }}>
                  All responding targets are within configured operational SLO thresholds.
                </div>
              </div>
            ) : (
              <div className="apple-table-container">
                <table className="apple-table">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Service</th>
                      <th style={{ width: 220 }}>Metric Name</th>
                      <th style={{ width: 100 }}>Value</th>
                      <th style={{ width: 100 }}>Threshold</th>
                      <th style={{ width: 110 }}>Severity</th>
                      <th>Diagnostic Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsData.anomalies.map((a, i) => (
                      <tr key={i}>
                        <td className="font-mono" style={{ fontSize: '11px' }}>{a.service}</td>
                        <td className="font-mono" style={{ fontSize: '11px', color: '#ff453a' }}>{a.metric}</td>
                        <td className="font-mono" style={{ fontWeight: 600 }}>{a.value}</td>
                        <td className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{a.threshold}</td>
                        <td>
                          <span className="status-pill status-pill-critical">{a.severity}</span>
                        </td>
                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{a.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: LOKI LOG STREAMS */}
      {activeSubTab === 'logs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Log Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} color="var(--text-tertiary)" style={{ position: 'absolute', left: 10, top: 9 }} />
              <input
                type="text"
                className="apple-input"
                placeholder="Filter logs by message regex, pattern, or keyword..."
                style={{ paddingLeft: 30 }}
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
              />
            </div>

            <select
              className="apple-select"
              style={{ width: 180 }}
              value={logFilterService}
              onChange={(e) => setLogFilterService(e.target.value)}
            >
              <option value="all">All Services</option>
              <option value="aiops-engine">aiops-engine (Debug Logs)</option>
              <option value="gateway-service">gateway-service</option>
              <option value="order-service">order-service</option>
              <option value="payment-service">payment-service</option>
            </select>

            <select
              className="apple-select"
              style={{ width: 140 }}
              value={logFilterLevel}
              onChange={(e) => setLogFilterLevel(e.target.value)}
            >
              <option value="ALL">All Levels</option>
              <option value="DEBUG">DEBUG & Above</option>
              <option value="INFO">INFO & Above</option>
              <option value="WARN">Warnings & Errors</option>
              <option value="ERROR">Errors Only</option>
            </select>
          </div>

          {/* Logs Table */}
          <div className="apple-table-container">
            <table className="apple-table font-mono" style={{ fontSize: '11px' }}>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Timestamp</th>
                  <th style={{ width: 140 }}>Service</th>
                  <th style={{ width: 90 }}>Level</th>
                  <th>Log Message Payload</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
                      <Terminal size={28} style={{ margin: '0 auto 8px', opacity: 0.6 }} />
                      <div style={{ fontSize: '12px' }}>Awaiting Incoming Telemetry Log Streams</div>
                      <div style={{ fontSize: '10px', marginTop: 2, color: 'var(--text-quaternary)' }}>
                        Ensure Loki is reachable at <span className="font-mono">http://localhost:3100</span> or services send to <span className="font-mono">/api/telemetry/buffer-log</span>.
                      </div>
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id}>
                      <td style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ color: l.service === 'aiops-engine' ? '#bf5af2' : '#64d2ff' }}>{l.service}</td>
                      <td>
                        <span 
                          className={`status-pill ${
                            l.level === 'ERROR' || l.level === 'CRITICAL' ? 'status-pill-critical' : 
                            l.level === 'WARN' ? 'status-pill-warning' : 
                            l.level === 'DEBUG' ? 'status-pill-neutral' : 'status-pill-healthy'
                          }`} 
                          style={{ 
                            fontSize: '9px',
                            color: l.level === 'DEBUG' ? '#bf5af2' : undefined,
                            borderColor: l.level === 'DEBUG' ? 'rgba(191, 90, 242, 0.3)' : undefined
                          }}
                        >
                          {l.level}
                        </span>
                      </td>
                      <td style={{ color: l.level === 'ERROR' ? '#ff453a' : l.level === 'DEBUG' ? 'var(--text-secondary)' : 'var(--text-primary)', wordBreak: 'break-all' }}>
                        {l.message}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
