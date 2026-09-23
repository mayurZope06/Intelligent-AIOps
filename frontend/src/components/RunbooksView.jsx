import React, { useState } from 'react';
import { BookOpen, Plus, Trash2, Search, FileText, CheckCircle2, X } from 'lucide-react';

export default function RunbooksView({
  runbooks,
  selectedRunbook,
  onSelectRunbook,
  onSaveRunbook,
  onDeleteRunbook
}) {
  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [formData, setFormData] = useState({ id: '', title: '', content: '' });

  const filteredRunbooks = runbooks.filter(rb => 
    rb.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    rb.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.title.trim()) return;
    onSaveRunbook(formData);
    setFormData({ id: '', title: '', content: '' });
    setShowModal(false);
  };

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Left Sidebar: Runbook List */}
      <div style={{
        width: 320,
        borderRight: '1px solid var(--apple-border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--apple-surface)',
        flexShrink: 0
      }}>
        {/* Header & Search */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--apple-border)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BookOpen size={15} color="#0071e3" />
              <span style={{ fontWeight: 600, fontSize: '13px' }}>Operational Runbooks</span>
            </div>
            <button 
              className="apple-btn apple-btn-primary" 
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => setShowModal(true)}
            >
              <Plus size={12} />
              <span>New SOP</span>
            </button>
          </div>

          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              className="apple-input"
              style={{ paddingLeft: 28, fontSize: '11px', width: '100%' }}
              placeholder="Filter runbooks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Runbook Items List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {filteredRunbooks.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', textAlign: 'center', padding: '32px 16px' }}>
              No runbooks found.
            </div>
          ) : (
            filteredRunbooks.map(rb => {
              const isSelected = selectedRunbook?.id === rb.id;
              return (
                <div
                  key={rb.id}
                  onClick={() => onSelectRunbook(rb)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    marginBottom: 4,
                    background: isSelected ? 'rgba(0, 113, 227, 0.12)' : 'transparent',
                    border: isSelected ? '1px solid rgba(0, 113, 227, 0.3)' : '1px solid transparent',
                    transition: 'all 0.12s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={13} color={isSelected ? '#0071e3' : '#8e8e93'} />
                    <span style={{ 
                      fontSize: '12px', 
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'
                    }}>
                      {rb.title}
                    </span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 4, marginLeft: 19 }}>
                    {rb.id}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Area: Selected Runbook Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--apple-canvas)', overflowY: 'auto' }}>
        {selectedRunbook ? (
          <div style={{ padding: '28px 36px', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Runbook Title Bar */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid var(--apple-border)', paddingBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 6 }}>
                  {selectedRunbook.title}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  <span className="font-mono">ID: {selectedRunbook.id}</span>
                  <span>•</span>
                  <span className="status-pill status-pill-healthy" style={{ fontSize: '10px' }}>
                    <CheckCircle2 size={10} style={{ marginRight: 3 }} /> RAG Vector Indexed
                  </span>
                </div>
              </div>

              <button
                className="apple-btn apple-btn-subtle"
                style={{ color: '#ff453a' }}
                onClick={() => onDeleteRunbook(selectedRunbook.id)}
              >
                <Trash2 size={13} />
                <span>Delete SOP</span>
              </button>
            </div>

            {/* Runbook Markdown Content */}
            <div className="apple-card" style={{ padding: 24 }}>
              <pre style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                lineHeight: 1.65,
                color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap',
                margin: 0
              }}>
                {selectedRunbook.content}
              </pre>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', gap: 8 }}>
            <BookOpen size={28} strokeWidth={1.5} />
            <span style={{ fontSize: '13px' }}>Select an operational runbook to inspect procedures</span>
          </div>
        )}
      </div>

      {/* Modal: New / Edit Runbook */}
      {showModal && (
        <div className="apple-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="apple-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <div className="apple-modal-header">
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Add Operational Runbook (SOP)</span>
              <button className="apple-btn apple-btn-subtle apple-btn-icon" onClick={() => setShowModal(false)}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="apple-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: 5 }}>
                    Runbook Title
                  </label>
                  <input
                    type="text"
                    required
                    className="apple-input"
                    style={{ width: '100%' }}
                    placeholder="e.g. Standard Operating Procedure: Payment Gateway Timeout"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: 5 }}>
                    Runbook ID (Identifier)
                  </label>
                  <input
                    type="text"
                    required
                    className="apple-input font-mono"
                    style={{ width: '100%' }}
                    placeholder="e.g. payment_gateway_timeout"
                    value={formData.id}
                    onChange={e => setFormData({ ...formData, id: e.target.value })}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: 5 }}>
                    Markdown SOP Procedure & Remediation Steps
                  </label>
                  <textarea
                    rows={10}
                    required
                    className="apple-input font-mono"
                    style={{ width: '100%', resize: 'vertical' }}
                    placeholder="## Symptoms&#10;- Latency spikes on /checkout...&#10;&#10;## Remediation Steps&#10;1. Check connection pool limits&#10;2. Restart worker pod..."
                    value={formData.content}
                    onChange={e => setFormData({ ...formData, content: e.target.value })}
                  />
                </div>
              </div>

              <div className="apple-modal-footer">
                <button type="button" className="apple-btn apple-btn-subtle" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="apple-btn apple-btn-primary">
                  Save & Index Runbook
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
