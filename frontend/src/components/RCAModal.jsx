import React from 'react';
import { Cpu, X, ShieldAlert, CheckCircle2, ArrowRight, Play, BookOpen, Layers } from 'lucide-react';

export default function RCAModal({
  isOpen,
  onClose,
  rcaReport,
  onApproveRemediation,
  remediating
}) {
  if (!isOpen || !rcaReport) return null;

  // Map the actual backend Gemini response fields to UI variables
  const rootCause = rcaReport.probableRootCause || rcaReport.rootCause || 'No root cause determined.';
  const confidence = rcaReport.confidence;                            // Already 0-100 integer from backend
  const incidentSummary = rcaReport.incidentSummary || '';
  const engine = rcaReport.provider || rcaReport.engine || 'Google Gemini LLM';
  const modelName = rcaReport.model || '';
  const incidentId = rcaReport.incidentId;

  // Causal chain: root service → cascading services
  const affectedServices = rcaReport.affectedServices || {};
  const causalChain = affectedServices.root
    ? [affectedServices.root, ...(affectedServices.cascading || [])]
    : [];

  // Evidence: array of strings
  const evidence = rcaReport.supportingEvidence || rcaReport.evidence || [];

  // Runbook match from RAG
  const retrievedKnowledge = rcaReport.retrievedKnowledge;
  const runbookMatch = retrievedKnowledge
    ? { title: retrievedKnowledge.runbookTitle, summary: retrievedKnowledge.guidanceSummary }
    : null;

  // Remediation action
  const remediation = rcaReport.remediation || {};
  const recommendedAction = remediation.title || rcaReport.recommendedAction;
  const actionType = remediation.actionType || rcaReport.actionType;
  const remediationCommand = remediation.command;
  const requiresApproval = remediation.requiresHumanApproval !== false;

  // Alternative causes
  const alternativeCauses = rcaReport.alternativeCauses || [];

  // Timeline
  const timeline = rcaReport.timeline || [];

  return (
    <div className="apple-modal-overlay" onClick={onClose}>
      <div className="apple-modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="apple-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={16} color="#64d2ff" />
            <div>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>AI Root Cause Analysis (RCA)</span>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                {engine}{modelName ? ` · ${modelName}` : ''}
              </div>
            </div>
          </div>
          <button className="apple-btn apple-btn-subtle apple-btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="apple-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '70vh', overflowY: 'auto' }}>

          {/* Incident Summary Banner */}
          <div style={{
            background: 'linear-gradient(180deg, rgba(191, 90, 242, 0.1) 0%, rgba(191, 90, 242, 0.03) 100%)',
            border: '1px solid rgba(191, 90, 242, 0.3)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#bf5af2' }}>
                Primary Diagnosis
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {rcaReport.severity && (
                  <span className="status-pill status-pill-critical" style={{ fontSize: '10px' }}>
                    {rcaReport.severity}
                  </span>
                )}
                {confidence != null && (
                  <span className="status-pill status-pill-healthy" style={{ fontSize: '10px' }}>
                    {confidence}% confidence
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: incidentSummary ? 8 : 0 }}>
              {rootCause}
            </div>
            {incidentSummary && (
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {incidentSummary}
              </div>
            )}
          </div>

          {/* Causal Propagation Chain: Root → Cascading */}
          {causalChain.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Layers size={12} /> Failure Propagation Chain
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {causalChain.map((svc, idx) => (
                  <React.Fragment key={idx}>
                    <div style={{
                      padding: '4px 10px',
                      background: idx === 0 ? 'rgba(255, 69, 58, 0.14)' : 'rgba(255, 159, 10, 0.08)',
                      border: `1px solid ${idx === 0 ? 'rgba(255, 69, 58, 0.4)' : 'rgba(255, 159, 10, 0.3)'}`,
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '11px',
                      color: idx === 0 ? '#ff453a' : '#ff9f0a',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {idx === 0 ? '⚑ ' : '↳ '}{svc}
                    </div>
                    {idx < causalChain.length - 1 && (
                      <ArrowRight size={12} color="var(--text-tertiary)" />
                    )}
                  </React.Fragment>
                ))}
              </div>
              {affectedServices.impact && (
                <div style={{ marginTop: 8, fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                  Impact: {affectedServices.impact}
                </div>
              )}
            </div>
          )}

          {/* Supporting Evidence */}
          {evidence.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <ShieldAlert size={12} /> Supporting Evidence ({evidence.length} signals)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {evidence.map((ev, idx) => (
                  <div key={idx} style={{
                    padding: '7px 11px',
                    background: 'rgba(255, 255, 255, 0.025)',
                    border: '1px solid var(--apple-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.4,
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {typeof ev === 'string' ? ev : JSON.stringify(ev)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alternative Causes */}
          {alternativeCauses.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Alternative Hypotheses
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {alternativeCauses.map((alt, idx) => (
                  <div key={idx} style={{
                    padding: '6px 11px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid var(--apple-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    lineHeight: 1.4
                  }}>
                    {idx + 1}. {alt}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Matched SOP Runbook */}
          {runbookMatch && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <BookOpen size={12} /> Matched Runbook (RAG)
              </div>
              <div style={{
                padding: '12px 14px',
                background: 'rgba(0, 113, 227, 0.06)',
                border: '1px solid rgba(0, 113, 227, 0.25)',
                borderRadius: 'var(--radius-md)'
              }}>
                <div style={{ fontWeight: 600, fontSize: '12px', color: '#0071e3', marginBottom: 4 }}>
                  {runbookMatch.title}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {runbookMatch.summary}
                </div>
              </div>
            </div>
          )}

          {/* Remediation Action */}
          {recommendedAction && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={12} /> Recommended Remediation
              </div>
              <div style={{
                padding: '12px 14px',
                background: 'rgba(48, 209, 88, 0.05)',
                border: '1px solid rgba(48, 209, 88, 0.2)',
                borderRadius: 'var(--radius-md)'
              }}>
                <div style={{ fontWeight: 600, fontSize: '12px', color: '#30d158', marginBottom: 6 }}>
                  {recommendedAction}
                </div>
                {remediationCommand && (
                  <div style={{
                    padding: '6px 10px',
                    background: 'rgba(0,0,0,0.35)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: '#30d158'
                  }}>
                    {remediationCommand}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="apple-modal-footer">
          <button className="apple-btn apple-btn-subtle" onClick={onClose}>
            Dismiss
          </button>
          {recommendedAction && requiresApproval && (
            <button
              className="apple-btn apple-btn-primary"
              disabled={remediating}
              onClick={() => onApproveRemediation(incidentId, actionType)}
              style={{ background: 'linear-gradient(135deg, #30d158 0%, #0071e3 100%)', border: 'none' }}
            >
              <Play size={12} />
              <span>{remediating ? 'Executing...' : 'Approve & Remediate'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
