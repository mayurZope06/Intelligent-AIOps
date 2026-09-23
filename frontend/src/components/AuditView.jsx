import React, { useState } from 'react';
import { History, ShieldCheck, CheckCircle2, Search, Filter } from 'lucide-react';

export default function AuditView({ auditLogs }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = auditLogs.filter(log =>
    (log.incidentId && log.incidentId.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (log.action && log.action.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (log.approvedBy && log.approvedBy.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '24px 28px', overflowY: 'auto', gap: 20 }}>
      {/* Top Header & Metrics */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <History size={16} color="#0071e3" />
            <h2 style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
              Remediation Action Audit Trail
            </h2>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
            Immutable ledger of Human-in-the-Loop operator approvals, automated rollbacks, and recovery verification.
          </p>
        </div>

        <div style={{ position: 'relative', width: 260 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            className="apple-input"
            style={{ paddingLeft: 28, fontSize: '11px', width: '100%' }}
            placeholder="Search audit trail..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Audit Table Card */}
      <div className="apple-card" style={{ overflow: 'hidden' }}>
        <table className="apple-table">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>Timestamp</th>
              <th style={{ width: '18%' }}>Incident Reference</th>
              <th style={{ width: '25%' }}>Remediation Action</th>
              <th style={{ width: '20%' }}>Approved By</th>
              <th style={{ width: '15%' }}>Execution State</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-tertiary)' }}>
                  <ShieldCheck size={28} strokeWidth={1.5} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.6 }} />
                  No remediation actions executed yet.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log, index) => (
                <tr key={index}>
                  <td className="font-mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A'}
                  </td>
                  <td>
                    <span className="font-mono" style={{ color: '#0071e3', fontSize: '11px', fontWeight: 500 }}>
                      {log.incidentId || 'SYS-EVENT'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="font-mono" style={{ fontSize: '11px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>
                        {log.action}
                      </span>
                    </div>
                  </td>
                  <td style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                    {log.approvedBy || 'SRE Autonomous Engine'}
                  </td>
                  <td>
                    <span className="status-pill status-pill-healthy" style={{ fontSize: '10px' }}>
                      <CheckCircle2 size={10} style={{ marginRight: 3 }} /> {log.result || 'SUCCESS'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
