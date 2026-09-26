import React from 'react';
import { 
  RefreshCw, CheckCircle2, AlertTriangle, AlertCircle, 
  X, Check, ShieldCheck, ShieldAlert, Activity, Radio
} from 'lucide-react';

export default function AsyncProgressHUD({ status, onDismiss }) {
  if (!status) return null;

  const isSpinning = status.phase === 'dispatching' || status.phase === 'awaiting_prometheus';
  const isVerified = status.phase === 'verified';
  const isFailed = status.phase === 'unverified' || status.phase === 'failed';
  const isBaseline = status.title?.toLowerCase().includes('nominal') || status.title?.toLowerCase().includes('baseline');

  // Determine stage progression (1: dispatch, 2: scrape, 3: verify)
  let activeStep = 1;
  let progressPercent = 25;
  if (status.phase === 'awaiting_prometheus') {
    activeStep = 2;
    progressPercent = 65;
  } else if (isVerified || isFailed) {
    activeStep = 3;
    progressPercent = 100;
  }

  // Color schemes and iconography based on operational state
  let accentColor = '#0a84ff';
  let glowColor = 'rgba(10, 132, 255, 0.25)';
  let tagText = 'TELEMETRY PIPELINE';
  let Icon = RefreshCw;

  if (status.type === 'inject') {
    if (isBaseline) {
      accentColor = '#30d158';
      glowColor = 'rgba(48, 209, 88, 0.25)';
      tagText = 'BASELINE RESTORED';
      Icon = CheckCircle2;
    } else if (isVerified) {
      accentColor = '#ff453a';
      glowColor = 'rgba(255, 69, 58, 0.3)';
      tagText = 'ANOMALY CONFIRMED';
      Icon = AlertTriangle;
    } else if (isFailed) {
      accentColor = '#ff9f0a';
      glowColor = 'rgba(255, 159, 10, 0.25)';
      tagText = 'INJECTION WARNING';
      Icon = AlertCircle;
    } else {
      accentColor = '#ff9f0a';
      glowColor = 'rgba(255, 159, 10, 0.2)';
      tagText = 'FAULT INJECTION';
      Icon = RefreshCw;
    }
  } else {
    // Remediation
    if (isVerified) {
      accentColor = '#30d158';
      glowColor = 'rgba(48, 209, 88, 0.3)';
      tagText = 'RECOVERY VERIFIED';
      Icon = ShieldCheck;
    } else if (isFailed) {
      accentColor = '#ff453a';
      glowColor = 'rgba(255, 69, 58, 0.3)';
      tagText = 'STILL FAILING';
      Icon = AlertCircle;
    } else {
      accentColor = '#64d2ff';
      glowColor = 'rgba(100, 210, 255, 0.25)';
      tagText = 'REMEDIATION DISPATCH';
      Icon = RefreshCw;
    }
  }

  const step3Label = isBaseline || (status.type === 'remediate' && isVerified)
    ? 'Telemetry Nominal'
    : (status.type === 'inject' && isVerified ? 'Incident Declared' : 'Verified State');

  return (
    <div className="async-hud-container" role="status" aria-live="polite">
      <div 
        className="async-hud-card"
        style={{
          '--hud-accent': accentColor,
          '--hud-glow': glowColor
        }}
      >
        {/* Subtle Top Accent Beam */}
        <div 
          className="async-hud-top-glow"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${glowColor} 0%, transparent 70%)`
          }} 
        />

        {/* Top Header Row: Icon + Title + Stage Badge + Close */}
        <div className="async-hud-top-row">
          <div className="async-hud-icon-badge" style={{ backgroundColor: `${accentColor}18`, borderColor: `${accentColor}35` }}>
            <Icon 
              size={15} 
              style={{ color: accentColor }} 
              className={isSpinning ? 'spin-smooth' : ''} 
            />
          </div>

          <div className="async-hud-heading-group">
            <span className="async-hud-title">{status.title}</span>
            <span className="async-hud-tag" style={{ color: accentColor, borderColor: `${accentColor}30`, backgroundColor: `${accentColor}10` }}>
              {tagText}
            </span>
          </div>

          {onDismiss && (
            <button className="async-hud-close" onClick={onDismiss} title="Dismiss notification">
              <X size={13} />
            </button>
          )}
        </div>

        {/* Informative Subtitle Message */}
        <div className="async-hud-body">
          <p className="async-hud-message">{status.message}</p>
        </div>

        {/* Enterprise Telemetry Stepper Pipeline */}
        <div className="async-hud-pipeline">
          <div className="pipeline-track-bg">
            <div 
              className="pipeline-track-fill" 
              style={{ 
                width: `${progressPercent}%`,
                background: `linear-gradient(90deg, ${accentColor}80, ${accentColor})`,
                boxShadow: `0 0 8px ${accentColor}`
              }} 
            />
          </div>

          <div className="pipeline-steps">
            {/* Step 1: Microservice Hook */}
            <div className={`pipeline-step ${activeStep >= 1 ? 'step-reached' : ''} ${activeStep === 1 ? 'step-current' : ''}`}>
              <div 
                className="step-pip"
                style={activeStep > 1 ? { backgroundColor: accentColor, borderColor: accentColor } : activeStep === 1 ? { borderColor: accentColor } : {}}
              >
                {activeStep > 1 ? (
                  <Check size={9} strokeWidth={3} color="#ffffff" />
                ) : (
                  <span className="step-pip-pulse" style={{ backgroundColor: accentColor }} />
                )}
              </div>
              <span className="step-label">1. Microservice Hook</span>
            </div>

            {/* Step 2: Prometheus Scrape Sync */}
            <div className={`pipeline-step ${activeStep >= 2 ? 'step-reached' : ''} ${activeStep === 2 ? 'step-current' : ''}`}>
              <div 
                className="step-pip"
                style={activeStep > 2 ? { backgroundColor: accentColor, borderColor: accentColor } : activeStep === 2 ? { borderColor: accentColor } : {}}
              >
                {activeStep > 2 ? (
                  <Check size={9} strokeWidth={3} color="#ffffff" />
                ) : activeStep === 2 ? (
                  <span className="step-pip-pulse" style={{ backgroundColor: accentColor }} />
                ) : (
                  <span className="step-pip-dot" />
                )}
              </div>
              <span className="step-label">2. Prometheus Sync</span>
            </div>

            {/* Step 3: Verified State */}
            <div className={`pipeline-step ${activeStep === 3 ? 'step-reached step-current' : ''}`}>
              <div 
                className="step-pip"
                style={activeStep === 3 ? { backgroundColor: accentColor, borderColor: accentColor } : {}}
              >
                {activeStep === 3 ? (
                  isFailed ? (
                    <AlertTriangle size={9} strokeWidth={3} color="#ffffff" />
                  ) : (
                    <Check size={9} strokeWidth={3} color="#ffffff" />
                  )
                ) : (
                  <span className="step-pip-dot" />
                )}
              </div>
              <span className="step-label">3. {step3Label}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
