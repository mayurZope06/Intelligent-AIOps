const dependencyTopology = require('../config/topology');
const prometheusAdapter = require('../adapters/prometheusAdapter');
const lokiAdapter = require('../adapters/lokiAdapter');

class CorrelationEngine {
  constructor() {
    this.topology = dependencyTopology;
  }

  // Correlate metrics and logs with service dependency graph
  async correlateSignals() {
    // 1. Gather live metrics
    const metricsData = await prometheusAdapter.queryMetrics();
    const anomalies = metricsData.anomalies;

    if (!anomalies || anomalies.length === 0) {
      return {
        hasIncident: false,
        message: 'All microservices are reporting normal metrics.'
      };
    }

    // 2. Determine affected services from metrics
    const affectedServiceNames = [...new Set(anomalies.map(a => a.service))];

    // 3. Fetch logs for all affected services
    const errorLogsByService = await lokiAdapter.getRecentErrorsForServices(affectedServiceNames);

    // 4. Build unified chronological event timeline
    const timeline = [];

    // Add metric anomalies into timeline
    anomalies.forEach(anomaly => {
      timeline.push({
        source: 'METRIC',
        service: anomaly.service,
        timestamp: metricsData.timestamp,
        severity: anomaly.severity,
        summary: anomaly.description,
        metric: anomaly.metric,
        value: anomaly.value
      });
    });

    // Add error logs into timeline
    for (const [service, logs] of Object.entries(errorLogsByService)) {
      logs.forEach(log => {
        timeline.push({
          source: 'LOG',
          service,
          timestamp: log.timestamp,
          severity: log.level,
          summary: log.message,
          rawLog: log
        });
      });
    }

    // Sort timeline chronologically
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // 5. Causal Analysis via Dependency Graph
    // Deepest service in the call chain exhibiting failure is likely the root origin.
    // Order of dependency depth: database > payment-service > order-service > gateway-service > frontend
    const dependencyDepth = {
      'database': 5,
      'payment-service': 4,
      'order-service': 3,
      'gateway-service': 2,
      'frontend': 1
    };

    let rootCauseCandidate = affectedServiceNames[0];
    let maxDepth = -1;

    for (const svc of affectedServiceNames) {
      const depth = dependencyDepth[svc] || 0;
      if (depth > maxDepth) {
        maxDepth = depth;
        rootCauseCandidate = svc;
      }
    }

    // Classify root vs cascading services
    const cascadingServices = affectedServiceNames.filter(s => s !== rootCauseCandidate);
    
    // Determine overall incident severity
    let overallSeverity = 'P2-High';
    if (anomalies.some(a => a.severity === 'CRITICAL') || affectedServiceNames.includes('payment-service')) {
      overallSeverity = 'P1-Critical';
    }

    // Extract core evidence snippets
    const evidenceSnippets = [];
    anomalies.forEach(a => evidenceSnippets.push(`[Metric] ${a.service}: ${a.metric} = ${a.value} (${a.description})`));
    
    for (const [svc, logs] of Object.entries(errorLogsByService)) {
      if (logs.length > 0) {
        evidenceSnippets.push(`[Log] ${svc}: "${logs[0].message}"`);
      }
    }

    return {
      hasIncident: true,
      timestamp: new Date().toISOString(),
      overallSeverity,
      rootCauseCandidate,
      affectedServices: {
        root: rootCauseCandidate,
        cascading: cascadingServices,
        all: affectedServiceNames
      },
      timeline,
      evidenceSnippets,
      anomalies,
      errorLogsByService
    };
  }
}

module.exports = new CorrelationEngine();
