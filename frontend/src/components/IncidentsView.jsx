import React, { useState } from 'react';
import { 
  AlertCircle, Search, Plus, Filter, Clock, CheckCircle2, 
  MessageSquare, Trash2, X, ChevronRight, ShieldAlert, Cpu 
} from 'lucide-react';

export default function IncidentsView({
  incidents,
  incidentMetrics,
  selectedIncident,
  onSelectIncident,
  onCreateIncident,
  onUpdateStatus,
  onDeleteIncident,
  onAddNote,
  onDiagnoseIncident,
  statusFilter,
  setStatusFilter,
  severityFilter,
  setSeverityFilter,
  searchQuery,
  setSearchQuery
}) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newService, setNewService] = useState('payment-service');
  const [newSeverity, setNewSeverity] = useState('P1-Critical');
  const [newDescription, setNewDescription] = useState('');
  const [noteText, setNoteText] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateIncident({
      title: newTitle,
      service: newService,
      severity: newSeverity,
      description: newDescription
    });
    setNewTitle('');
    setNewDescription('');
    setShowCreateModal(false);
  };

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!noteText.trim() || !selectedIncident) return;
    onAddNote(selectedIncident.id, noteText);
    setNoteText('');
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', position: 'relative' }}>
      {/* Main Incidents Area */}
      <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Metric Cards Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          <div className="apple-card" style={{ padding: '14px 16px' }}>
            <div className="section-title">Open Incidents</div>
            <div className="headline" style={{ color: incidentMetrics.openIncidents > 0 ? '#ff453a' : 'var(--text-primary)' }}>
              {incidentMetrics.openIncidents || 0}
            </div>
          </div>

          <div className="apple-card" style={{ padding: '14px 16px' }}>
            <div className="section-title">Resolved Incidents</div>
            <div className="headline" style={{ color: '#30d158' }}>
              {incidentMetrics.resolvedIncidents || 0}
            </div>
          </div>

          <div className="apple-card" style={{ padding: '14px 16px' }}>
            <div className="section-title">Average MTTR</div>
            <div className="headline font-mono">
              {incidentMetrics.averageMTTRSeconds || 0}<span style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginLeft: 4 }}>sec</span>
            </div>
          </div>

          <div className="apple-card" style={{ padding: '14px 16px' }}>
            <div className="section-title">Total Tracked</div>
            <div className="headline">
              {incidentMetrics.totalIncidents || 0}
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <div style={{ position: 'relative', width: 260 }}>
              <Search size={14} color="var(--text-tertiary)" style={{ position: 'absolute', left: 10, top: 9 }} />
              <input
                type="text"
                className="apple-input"
                placeholder="Search incidents by title or ID..."
                style={{ paddingLeft: 30 }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select 
              className="apple-select" 
              style={{ width: 140 }}
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="RESOLVED">Resolved</option>
            </select>

            <select 
              className="apple-select" 
              style={{ width: 140 }}
              value={severityFilter} 
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              <option value="ALL">All Severities</option>
              <option value="P1-Critical">P1 - Critical</option>
              <option value="P2-High">P2 - High</option>
              <option value="P3-Moderate">P3 - Moderate</option>
            </select>
          </div>

          <button className="apple-btn apple-btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={14} />
            <span>Declare Incident</span>
          </button>
        </div>

        {/* Incidents Table */}
        <div className="apple-table-container">
          <table className="apple-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Incident ID</th>
                <th>Title & Description</th>
                <th style={{ width: 140 }}>Service</th>
                <th style={{ width: 110 }}>Severity</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 120 }}>Created</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {incidents.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
                    <CheckCircle2 size={32} color="#30d158" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>No Incidents Logged</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: 2 }}>
                      System telemetry is either nominal or awaiting telemetry correlation.
                    </div>
                  </td>
                </tr>
              ) : (
                incidents.map((inc) => (
                  <tr 
                    key={inc.id}
                    onClick={() => onSelectIncident(inc)}
                    style={{ 
                      cursor: 'pointer',
                      background: selectedIncident?.id === inc.id ? 'var(--apple-surface-hover)' : 'transparent' 
                    }}
                  >
                    <td className="font-mono" style={{ fontSize: '11px', color: '#64d2ff' }}>{inc.id}</td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{inc.title}</div>
                      {inc.description && (
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                          {inc.description}
                        </div>
                      )}
                    </td>
                    <td className="font-mono" style={{ fontSize: '11px' }}>{inc.service}</td>
                    <td>
                      <span className={`status-pill ${inc.severity === 'P1-Critical' ? 'status-pill-critical' : inc.severity === 'P2-High' ? 'status-pill-warning' : 'status-pill-neutral'}`}>
                        {inc.severity}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${inc.status === 'RESOLVED' ? 'status-pill-healthy' : inc.status === 'INVESTIGATING' ? 'status-pill-warning' : 'status-pill-critical'}`}>
                        {inc.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      {new Date(inc.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <ChevronRight size={14} color="var(--text-tertiary)" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Incident Details Drawer */}
      {selectedIncident && (
        <div className="apple-drawer">
          <div className="apple-drawer-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="font-mono" style={{ fontSize: '11px', color: '#64d2ff' }}>{selectedIncident.id}</span>
                <span className={`status-pill ${selectedIncident.status === 'RESOLVED' ? 'status-pill-healthy' : 'status-pill-critical'}`}>
                  {selectedIncident.status}
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: '13px', marginTop: 4 }}>{selectedIncident.title}</div>
            </div>
            <button className="apple-btn apple-btn-subtle apple-btn-icon" onClick={() => onSelectIncident(null)}>
              <X size={15} />
            </button>
          </div>

          <div className="apple-drawer-body">
            {/* Status Change Section */}
            <div style={{ marginBottom: 16 }}>
              <div className="section-title">Lifecycle State</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['OPEN', 'INVESTIGATING', 'RESOLVED'].map((st) => (
                  <button
                    key={st}
                    className={`apple-btn ${selectedIncident.status === st ? 'apple-btn-secondary' : 'apple-btn-subtle'}`}
                    style={{ flex: 1, fontSize: '11px', padding: '6px 0' }}
                    onClick={() => onUpdateStatus(selectedIncident.id, st)}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Diagnose Action */}
            <div style={{ marginBottom: 16 }}>
              <button
                className="apple-btn apple-btn-primary"
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  background: 'linear-gradient(135deg, #0071e3 0%, #bf5af2 100%)',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  boxShadow: '0 2px 10px rgba(191, 90, 242, 0.25)'
                }}
                onClick={() => onDiagnoseIncident && onDiagnoseIncident(selectedIncident.id)}
              >
                <Cpu size={14} style={{ marginRight: 6 }} />
                <span>Diagnose with Gemini 3.5 Flash Lite</span>
              </button>
            </div>

            {/* AI Analysis Snapshot if available */}
            {selectedIncident.analysis && (
              <div style={{ marginBottom: 16 }}>
                <div className="section-title">Causal Root Cause Analysis</div>
                <div className="apple-card" style={{ padding: 12, borderLeft: '3px solid #bf5af2' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#f5f5f7' }}>
                    {selectedIncident.analysis.probableRootCause}
                  </div>
                  {selectedIncident.analysis.incidentSummary && (
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 6 }}>
                      {selectedIncident.analysis.incidentSummary}
                    </div>
                  )}
                  {selectedIncident.analysis.provider && (
                    <div style={{ fontSize: '10px', color: '#bf5af2', marginTop: 6 }}>
                      Source: {selectedIncident.analysis.provider}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Incident Journal & Notes */}
            <div style={{ marginBottom: 16 }}>
              <div className="section-title">Operator Notes ({selectedIncident.notes?.length || 0})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                {(!selectedIncident.notes || selectedIncident.notes.length === 0) ? (
                  <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                    No notes recorded yet.
                  </div>
                ) : (
                  selectedIncident.notes.map((n, i) => (
                    <div key={i} className="apple-card" style={{ padding: '8px 10px', background: 'rgba(255, 255, 255, 0.02)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        <span style={{ fontWeight: 600 }}>{n.author}</span>
                        <span>{new Date(n.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-primary)', marginTop: 4 }}>
                        {n.text}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Add Note Form */}
              <form onSubmit={handleAddNote} style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  className="apple-input"
                  placeholder="Add note to timeline..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                />
                <button type="submit" className="apple-btn apple-btn-secondary" disabled={!noteText.trim()}>
                  Post
                </button>
              </form>
            </div>

            {/* Destructive Action */}
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--apple-border)' }}>
              <button 
                className="apple-btn apple-btn-destructive" 
                style={{ width: '100%' }}
                onClick={() => onDeleteIncident(selectedIncident.id)}
              >
                <Trash2 size={13} />
                <span>Delete Incident Record</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Declare Incident Modal */}
      {showCreateModal && (
        <div className="apple-modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="apple-modal" onClick={(e) => e.stopPropagation()}>
            <div className="apple-modal-header">
              <div style={{ fontWeight: 600, fontSize: '13px' }}>Declare Production Incident</div>
              <button className="apple-btn apple-btn-subtle apple-btn-icon" onClick={() => setShowCreateModal(false)}>
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="apple-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label className="section-title" style={{ display: 'block', marginBottom: 4 }}>Title</label>
                  <input
                    type="text"
                    className="apple-input"
                    placeholder="e.g., Elevated error rate on payment processing"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="section-title" style={{ display: 'block', marginBottom: 4 }}>Impacted Service</label>
                    <select className="apple-select" value={newService} onChange={(e) => setNewService(e.target.value)}>
                      <option value="gateway-service">gateway-service</option>
                      <option value="auth-service">auth-service</option>
                      <option value="order-service">order-service</option>
                      <option value="inventory-service">inventory-service</option>
                      <option value="payment-service">payment-service</option>
                      <option value="notification-service">notification-service</option>
                      <option value="cache-redis">cache-redis</option>
                      <option value="database">database</option>
                      <option value="payment-gateway">payment-gateway</option>
                    </select>
                  </div>

                  <div>
                    <label className="section-title" style={{ display: 'block', marginBottom: 4 }}>Severity</label>
                    <select className="apple-select" value={newSeverity} onChange={(e) => setNewSeverity(e.target.value)}>
                      <option value="P1-Critical">P1 - Critical</option>
                      <option value="P2-High">P2 - High</option>
                      <option value="P3-Moderate">P3 - Moderate</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="section-title" style={{ display: 'block', marginBottom: 4 }}>Description</label>
                  <textarea
                    className="apple-input"
                    rows={3}
                    placeholder="Provide details on symptom, customer impact, or observation..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="apple-modal-footer">
                <button type="button" className="apple-btn apple-btn-subtle" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="apple-btn apple-btn-primary">
                  Declare Incident
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
