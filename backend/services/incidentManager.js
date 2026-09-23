const storage = require('./storage');

class IncidentManager {
  constructor() {
    this.incidentsFile = 'incidents.json';
    this.auditFile = 'audit_logs.json';
    this.init();
  }

  init() {
    const existing = storage.read(this.incidentsFile, null);
    if (!existing) {
      storage.write(this.incidentsFile, []);
    }
    const existingAudit = storage.read(this.auditFile, null);
    if (!existingAudit) {
      storage.write(this.auditFile, []);
    }
  }

  getAll(filter = {}) {
    let list = storage.read(this.incidentsFile, []);
    
    if (filter.status && filter.status !== 'ALL') {
      list = list.filter(i => i.status === filter.status);
    }
    if (filter.severity && filter.severity !== 'ALL') {
      list = list.filter(i => i.severity === filter.severity);
    }
    if (filter.service && filter.service !== 'ALL') {
      list = list.filter(i => i.service === filter.service);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(i => 
        i.title?.toLowerCase().includes(q) || 
        i.id?.toLowerCase().includes(q) ||
        i.service?.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getById(id) {
    const list = storage.read(this.incidentsFile, []);
    return list.find(i => i.id === id) || null;
  }

  create({ title, description, service, severity = 'P1-Critical', analysis = null, trigger = 'MANUAL' }) {
    const list = storage.read(this.incidentsFile, []);
    const id = `INC-${Math.floor(1000 + Math.random() * 9000)}`;
    
    const incident = {
      id,
      title: title || `Incident detected in ${service}`,
      description: description || 'Automated incident generated from cross-source telemetry correlation.',
      service: service || 'gateway-service',
      severity,
      status: 'OPEN',
      trigger,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolutionDurationSeconds: null,
      resolutionNotes: '',
      notes: [],
      analysis,
      remediationAudit: null
    };

    list.unshift(incident);
    storage.write(this.incidentsFile, list);
    return incident;
  }

  createIncident(params) {
    return this.create(params);
  }

  update(id, updates = {}) {
    const list = storage.read(this.incidentsFile, []);
    const idx = list.findIndex(i => i.id === id);
    if (idx === -1) return null;

    const existing = list[idx];
    const updated = { ...existing, ...updates };

    if (updates.status === 'RESOLVED' && existing.status !== 'RESOLVED') {
      updated.resolvedAt = new Date().toISOString();
      const start = new Date(existing.createdAt).getTime();
      const end = new Date(updated.resolvedAt).getTime();
      updated.resolutionDurationSeconds = Math.max(5, Math.round((end - start) / 1000));
    } else if (updates.status === 'OPEN' || updates.status === 'INVESTIGATING') {
      if (existing.status === 'RESOLVED') {
        updated.resolvedAt = null;
        updated.resolutionDurationSeconds = null;
      }
    }

    list[idx] = updated;
    storage.write(this.incidentsFile, list);
    return updated;
  }

  delete(id) {
    const list = storage.read(this.incidentsFile, []);
    const filtered = list.filter(i => i.id !== id);
    if (filtered.length === list.length) return false;
    storage.write(this.incidentsFile, filtered);
    return true;
  }

  addNote(id, { author = 'Operator', text }) {
    const list = storage.read(this.incidentsFile, []);
    const idx = list.findIndex(i => i.id === id);
    if (idx === -1) return null;

    if (!list[idx].notes) list[idx].notes = [];
    const note = {
      id: `note-${Date.now()}`,
      author,
      text,
      timestamp: new Date().toISOString()
    };
    list[idx].notes.push(note);
    storage.write(this.incidentsFile, list);
    return note;
  }

  recordRemediation(id, { action, approvedBy = 'DevOps SRE', result = 'SUCCESS' }) {
    const auditLogs = storage.read(this.auditFile, []);
    const auditEntry = {
      incidentId: id,
      action,
      approvedBy,
      result,
      timestamp: new Date().toISOString()
    };
    auditLogs.unshift(auditEntry);
    storage.write(this.auditFile, auditLogs);

    // Update incident state to RESOLVED
    this.update(id, {
      status: 'RESOLVED',
      resolutionNotes: `Remediation action '${action}' approved by ${approvedBy} and executed successfully.`,
      remediationAudit: auditEntry
    });

    return auditEntry;
  }

  getMetrics() {
    const list = storage.read(this.incidentsFile, []);
    const resolved = list.filter(i => i.status === 'RESOLVED');
    const open = list.filter(i => i.status === 'OPEN' || i.status === 'INVESTIGATING');

    const totalSeconds = resolved.reduce((acc, cur) => acc + (cur.resolutionDurationSeconds || 0), 0);
    const avgMTTR = resolved.length ? Math.round(totalSeconds / resolved.length) : 0;

    const bySeverity = {
      critical: list.filter(i => i.severity?.includes('Critical')).length,
      high: list.filter(i => i.severity?.includes('High')).length,
      medium: list.filter(i => i.severity?.includes('Medium')).length,
      low: list.filter(i => i.severity?.includes('Low')).length
    };

    return {
      totalIncidents: list.length,
      openIncidents: open.length,
      resolvedIncidents: resolved.length,
      averageMTTRSeconds: avgMTTR,
      severityBreakdown: bySeverity
    };
  }

  getAuditLogs() {
    return storage.read(this.auditFile, []);
  }
}

module.exports = new IncidentManager();
