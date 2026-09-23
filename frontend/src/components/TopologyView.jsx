import React, { useState } from 'react';
import ReactFlow, { Background, Controls, MarkerType, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import { Server, Database, Layers, X, ExternalLink, ShieldAlert, CheckCircle2 } from 'lucide-react';

// Custom Apple-style Squircle Node
const AppleServiceNode = ({ data, selected }) => {
  const status = (data.status || 'HEALTHY').toUpperCase();
  const Icon = data.type === 'database' ? Database : data.type === 'client' ? Layers : Server;

  const isFailing = status === 'CRITICAL' || status === 'OFFLINE';

  let statusClass = 'healthy';
  let pillClass = 'status-pill-healthy';
  let iconColor = '#30d158';
  let handleColor = '#0071e3';

  if (status === 'OFFLINE') {
    statusClass = 'critical';
    pillClass = 'status-pill-critical';
    iconColor = '#ff453a';
    handleColor = '#ff453a';
  } else if (status === 'CRITICAL') {
    statusClass = 'critical';
    pillClass = 'status-pill-critical';
    iconColor = '#ff453a';
    handleColor = '#ff453a';
  } else if (status === 'DEGRADED') {
    statusClass = 'warning';
    pillClass = 'status-pill-warning';
    iconColor = '#ff9f0a';
    handleColor = '#ff9f0a';
  }

  return (
    <div className={`rf-node-apple ${statusClass} ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ background: handleColor, width: 7, height: 7, border: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={14} color={iconColor} />
          <span style={{ fontWeight: 600, fontSize: '12px' }}>{data.name}</span>
        </div>
        <span className={`status-pill ${pillClass}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
          {status}
        </span>
      </div>

      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between' }}>
        <span className="font-mono">:{data.port || '27017'}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>{data.team}</span>
      </div>

      {status === 'OFFLINE' && (
        <div style={{ marginTop: 6, fontSize: '10px', color: '#ff453a', background: 'var(--apple-red-dim)', padding: '2px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <ShieldAlert size={10} />
          <span>Outage: Connection Refused</span>
        </div>
      )}

      {data.anomalies && data.anomalies.length > 0 && status !== 'OFFLINE' && (
        <div style={{
          marginTop: 6,
          fontSize: '10px',
          color: status === 'CRITICAL' ? '#ff453a' : '#ff9f0a',
          background: status === 'CRITICAL' ? 'var(--apple-red-dim)' : 'var(--apple-orange-dim)',
          border: `1px solid ${status === 'CRITICAL' ? 'rgba(255, 69, 58, 0.3)' : 'rgba(255, 159, 10, 0.3)'}`,
          padding: '3px 6px',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          lineHeight: 1.2
        }}>
          <ShieldAlert size={10} style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.anomalies[0].description || `${data.anomalies[0].metric}: ${data.anomalies[0].value}`}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: handleColor, width: 7, height: 7, border: 'none' }} />
    </div>
  );
};

const nodeTypes = {
  serviceNode: AppleServiceNode
};

export default function TopologyView({ nodes, edges, onSelectNode, selectedNode }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: 'calc(100vh - 52px)', minHeight: '500px', flex: 1 }}>
      {/* ReactFlow Topology Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
        style={{ width: '100%', height: 'calc(100vh - 52px)' }}
        onNodeClick={(_, node) => onSelectNode(node.data)}
        onPaneClick={() => onSelectNode(null)}
      >
        <Background color="rgba(255, 255, 255, 0.06)" gap={24} size={1} />
        <Controls showInteractive={false} style={{ border: '1px solid var(--apple-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }} />
      </ReactFlow>

      {/* Slide-over Service Inspector Drawer */}
      {selectedNode && (
        <div className="apple-drawer">
          <div className="apple-drawer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Server size={16} color="#0071e3" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{selectedNode.name}</div>
                <div className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>ID: {selectedNode.id}</div>
              </div>
            </div>
            <button className="apple-btn apple-btn-subtle apple-btn-icon" onClick={() => onSelectNode(null)}>
              <X size={15} />
            </button>
          </div>

          <div className="apple-drawer-body">
            {/* Status Section */}
            <div style={{ marginBottom: 16 }}>
              <div className="section-title">Operational Status</div>
              <div className="apple-card" style={{ padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Probe State</span>
                  <span className={`status-pill ${selectedNode.status === 'HEALTHY' ? 'status-pill-healthy' : selectedNode.status === 'CRITICAL' ? 'status-pill-critical' : 'status-pill-neutral'}`}>
                    {selectedNode.status || 'UNKNOWN'}
                  </span>
                </div>
                {selectedNode.serviceInfo?.error && (
                  <div style={{ marginTop: 8, fontSize: '11px', color: 'var(--text-tertiary)', background: 'rgba(255, 255, 255, 0.03)', padding: '6px 8px', borderRadius: 4 }}>
                    Probe Note: {selectedNode.serviceInfo.error}
                  </div>
                )}
              </div>
            </div>

            {/* Architecture Metadata */}
            <div style={{ marginBottom: 16 }}>
              <div className="section-title">Architectural Metadata</div>
              <div className="apple-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Service Port</span>
                  <span className="font-mono">:{selectedNode.port || '27017'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Owning Team</span>
                  <span>{selectedNode.team || 'Platform Core'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Architecture Layer</span>
                  <span style={{ textTransform: 'capitalize' }}>{selectedNode.type || 'service'}</span>
                </div>
                {selectedNode.serviceInfo?.endpoint && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Metrics Target</span>
                    <span className="font-mono" style={{ fontSize: '11px', color: '#64d2ff' }}>{selectedNode.serviceInfo.endpoint}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Telemetry Anomalies */}
            <div>
              <div className="section-title">Active Anomalies ({selectedNode.anomalies?.length || 0})</div>
              {(!selectedNode.anomalies || selectedNode.anomalies.length === 0) ? (
                <div className="apple-card" style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                  <CheckCircle2 size={24} color="#30d158" style={{ margin: '0 auto 8px', opacity: 0.8 }} />
                  <div>No metric threshold breaches observed.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedNode.anomalies.map((a, i) => (
                    <div key={i} className="apple-card" style={{ padding: 12, borderLeft: '3px solid #ff453a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600 }}>
                        <span className="font-mono" style={{ color: '#ff453a' }}>{a.metric}</span>
                        <span className="status-pill status-pill-critical">{a.severity}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {a.description}
                      </div>
                      <div className="font-mono" style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: 4 }}>
                        Observed: {a.value} | Threshold: {a.threshold}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
