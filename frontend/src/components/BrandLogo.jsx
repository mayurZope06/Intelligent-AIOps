import React, { useState } from 'react';

/**
 * Creative Brand Logo for Intelligent AIOps
 * Renders the glowing cybernetic neural brain & telemetry wave emblem with ambient backlighting.
 */
export default function BrandLogo({ size = 32, showGlow = true }) {
  const [imageError, setImageError] = useState(false);

  return (
    <div 
      className="brand-logo-wrapper"
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}
    >
      {showGlow && (
        <div 
          className="brand-logo-ambient-glow"
          style={{
            position: 'absolute',
            inset: -3,
            borderRadius: '10px',
            background: 'radial-gradient(circle, rgba(100, 210, 255, 0.4) 0%, rgba(0, 113, 227, 0.25) 50%, transparent 80%)',
            filter: 'blur(5px)',
            opacity: 0.85,
            zIndex: 0,
            pointerEvents: 'none'
          }}
        />
      )}

      {!imageError ? (
        <img
          src="/logo.png"
          alt="Intelligent AIOps Logo"
          onError={() => setImageError(true)}
          style={{
            width: size,
            height: size,
            borderRadius: '8px',
            objectFit: 'cover',
            position: 'relative',
            zIndex: 1,
            boxShadow: '0 4px 14px rgba(0, 113, 227, 0.3), 0 2px 6px rgba(0, 0, 0, 0.8)',
            border: '1px solid rgba(100, 210, 255, 0.3)'
          }}
        />
      ) : (

      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'relative',
          zIndex: 1,
          borderRadius: Math.round(size * 0.26),
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.25)',
          overflow: 'hidden'
        }}
      >
        <defs>
          {/* Obsidian Gradient Background */}
          <linearGradient id="bg-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#121826" />
            <stop offset="100%" stopColor="#080b12" />
          </linearGradient>

          {/* Border Glow Gradient */}
          <linearGradient id="border-grad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#64d2ff" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#0071e3" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#bf5af2" stopOpacity="0.8" />
          </linearGradient>

          {/* Telemetry Wave Gradient */}
          <linearGradient id="pulse-grad" x1="10" y1="50" x2="90" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#64d2ff" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#bf5af2" />
          </linearGradient>

          {/* Neural Node Glow Filter */}
          <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Squircle Chassis */}
        <rect
          x="3"
          y="3"
          width="94"
          height="94"
          rx="24"
          fill="url(#bg-grad)"
          stroke="url(#border-grad)"
          strokeWidth="2.5"
        />

        {/* Neural Network Topology Constellation (Background Layer) */}
        <g stroke="rgba(100, 210, 255, 0.2)" strokeWidth="1">
          {/* Topology Connections */}
          <line x1="26" y1="28" x2="48" y2="20" />
          <line x1="48" y1="20" x2="74" y2="28" />
          <line x1="26" y1="28" x2="22" y2="52" />
          <line x1="74" y1="28" x2="78" y2="52" />
          <line x1="22" y1="52" x2="32" y2="76" />
          <line x1="78" y1="52" x2="68" y2="76" />
          <line x1="32" y1="76" x2="50" y2="82" />
          <line x1="68" y1="76" x2="50" y2="82" />
          <line x1="48" y1="20" x2="50" y2="82" strokeDasharray="3 3" stroke="rgba(191, 90, 242, 0.25)" />
        </g>

        {/* Neural Node Dots */}
        <g fill="#64d2ff" filter="url(#neon-glow)">
          <circle cx="26" cy="28" r="3" />
          <circle cx="48" cy="20" r="3.5" fill="#ffffff" />
          <circle cx="74" cy="28" r="3" />
          <circle cx="22" cy="52" r="2.5" />
          <circle cx="78" cy="52" r="2.5" />
          <circle cx="32" cy="76" r="3" fill="#bf5af2" />
          <circle cx="50" cy="82" r="3.5" fill="#bf5af2" />
          <circle cx="68" cy="76" r="3" fill="#bf5af2" />
        </g>

        {/* Foreground Real-Time Telemetry ECG Wave */}
        <path
          d="M 14 50 L 32 50 L 38 42 L 44 62 L 52 26 L 60 72 L 66 45 L 72 50 L 86 50"
          stroke="url(#pulse-grad)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#neon-glow)"
        />
      </svg>
      )}
    </div>
  );
}
