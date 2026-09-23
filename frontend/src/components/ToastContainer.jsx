import React from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

export default function ToastContainer({ toasts = [], onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div 
      className="toast-container"
      style={{
        position: 'fixed',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        maxWidth: 460,
        width: 'calc(100% - 32px)',
        pointerEvents: 'none'
      }}
    >
      {toasts.map(t => {
        const isSuccess = t.type === 'success';
        const isError = t.type === 'error';
        const isWarning = t.type === 'warning';
        
        let accentColor = '#64d2ff';
        let Icon = Info;

        if (isSuccess) {
          accentColor = '#30d158';
          Icon = CheckCircle2;
        } else if (isError) {
          accentColor = '#ff453a';
          Icon = AlertCircle;
        } else if (isWarning) {
          accentColor = '#ff9f0a';
          Icon = AlertTriangle;
        }

        return (
          <div
            key={t.id}
            className="apple-toast-card animate-slide-in"
            style={{
              pointerEvents: 'auto',
              width: '100%',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '14px 16px',
              borderRadius: 12,
              background: 'rgba(18, 24, 38, 0.92)',
              backdropFilter: 'blur(24px) saturate(180%)',
              WebkitBackdropFilter: 'blur(24px) saturate(180%)',
              border: `1px solid rgba(255, 255, 255, 0.12)`,
              borderLeft: `4px solid ${accentColor}`,
              boxShadow: `0 12px 32px rgba(0, 0, 0, 0.6), 0 0 20px ${accentColor}25`,
              color: '#f5f5f7',
              position: 'relative',
              overflow: 'hidden',
              transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
          >
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              <Icon size={18} color={accentColor} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              {t.title && (
                <div style={{ fontWeight: 600, fontSize: '13px', letterSpacing: '-0.01em', marginBottom: 2 }}>
                  {t.title}
                </div>
              )}
              <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.85)', lineHeight: 1.45, wordBreak: 'break-word' }}>
                {t.message}
              </div>
            </div>

            <button
              onClick={() => onDismiss(t.id)}
              className="apple-btn apple-btn-subtle apple-btn-icon"
              style={{
                width: 20,
                height: 20,
                padding: 0,
                opacity: 0.6,
                flexShrink: 0,
                background: 'transparent',
                border: 'none',
                color: 'white',
                cursor: 'pointer'
              }}
              title="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
