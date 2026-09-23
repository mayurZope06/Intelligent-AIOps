import React, { useState, useEffect } from 'react';
import { Settings, X, Key, Cpu, CheckCircle2, Shield } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  settingsStatus,
  onSaveSettings
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash-lite');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settingsStatus?.model) {
      setModel(settingsStatus.model);
    }
  }, [settingsStatus]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings({ apiKey, model });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="apple-modal-overlay" onClick={onClose}>
      <div className="apple-modal" onClick={e => e.stopPropagation()}>
        <div className="apple-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} color="#0071e3" />
            <span style={{ fontWeight: 600, fontSize: '14px' }}>AIOps Engine Settings</span>
          </div>
          <button className="apple-btn apple-btn-subtle apple-btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="apple-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Gemini API Key */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Key size={12} /> Google Gemini API Key
                </label>
                {settingsStatus?.hasKey && (
                  <span className="status-pill status-pill-healthy" style={{ fontSize: '9px' }}>
                    <CheckCircle2 size={9} style={{ marginRight: 3 }} /> Configured
                  </span>
                )}
              </div>
              <input
                type="password"
                className="apple-input font-mono"
                style={{ width: '100%' }}
                placeholder={settingsStatus?.hasKey ? `Configured (${settingsStatus.maskedKey})` : "Enter Gemini API Key..."}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                Saved locally to <code className="font-mono">backend/data/settings.json</code>.
              </span>
            </div>

            {/* Model Selection */}
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                <Cpu size={12} /> Gemini Model Selection
              </label>
              <select
                className="apple-select"
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Active & Recommended)</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash (Fast & Verified)</option>
                <option value="gemini-3.6-flash">gemini-3.6-flash (Latest Stable)</option>
              </select>
              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 4, display: 'block' }}>
                Used for Root Cause Analysis (RCA) synthesis and RAG runbook matching.
              </span>
            </div>

            {/* Offline Fallback Callout */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--apple-border)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              display: 'flex',
              gap: 10
            }}>
              <Shield size={16} color="#30d158" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '11px', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                <strong>Topological Fallback Active</strong>: In the event of API quotas or network partitions, the platform automatically routes diagnoses through deterministic graph causal inference.
              </div>
            </div>
          </div>

          <div className="apple-modal-footer">
            <button type="button" className="apple-btn apple-btn-subtle" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="apple-btn apple-btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
