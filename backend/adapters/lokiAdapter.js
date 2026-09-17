const axios = require('axios');

class LokiAdapter {
  constructor() {
    this.lokiUrl = process.env.LOKI_URL || 'http://localhost:3100';
    // Circular buffer for 500 most recent logs
    this.localLogBuffer = [];
    this.maxBufferSize = 500;
  }

  // Ingest log directly into buffer (used by microservice telemetryClient)
  pushLog(logEntry) {
    this.localLogBuffer.unshift({
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: logEntry.timestamp || new Date().toISOString(),
      service: logEntry.service || 'unknown',
      level: (logEntry.level || 'info').toUpperCase(),
      message: logEntry.message || '',
      meta: logEntry.meta || {}
    });

    if (this.localLogBuffer.length > this.maxBufferSize) {
      this.localLogBuffer.pop();
    }
  }

  // Fetch logs with optional filtering by service and level
  async queryLogs({ service, level, limit = 50, onlyErrors = false } = {}) {
    // 1. Try querying real Loki if reachable
    try {
      let query = '{app=~".+"}';
      if (service) {
        query = `{app="${service}"}`;
      }
      if (onlyErrors) {
        query += ' |= "error"';
      }

      const response = await axios.get(`${this.lokiUrl}/loki/api/v1/query_range`, {
        params: {
          query,
          limit,
          start: (Date.now() - 10 * 60 * 1000) * 1000000 // Last 10 minutes in nanoseconds
        },
        timeout: 1000
      });

      if (response.data && response.data.data && response.data.data.result.length > 0) {
        const lokiLogs = [];
        for (const stream of response.data.data.result) {
          const appName = stream.stream.app || service || 'app';
          for (const val of stream.values) {
            lokiLogs.push({
              id: `loki-${val[0]}`,
              timestamp: new Date(parseInt(val[0]) / 1000000).toISOString(),
              service: appName,
              level: val[1].includes('error') ? 'ERROR' : val[1].includes('warn') ? 'WARN' : 'INFO',
              message: val[1]
            });
          }
        }
        return lokiLogs.slice(0, limit);
      }
    } catch (e) {
      // Loki not running or request timed out, proceed to in-memory buffer
    }

    // 2. Query in-memory log buffer (zero dependency)
    let filtered = [...this.localLogBuffer];

    if (service && service !== 'all') {
      filtered = filtered.filter(l => l.service === service);
    }

    if (onlyErrors) {
      filtered = filtered.filter(l => l.level === 'ERROR' || l.level === 'CRITICAL');
    } else if (level && level !== 'ALL') {
      filtered = filtered.filter(l => l.level === level.toUpperCase());
    }

    return filtered.slice(0, limit);
  }

  // Get aggregated error summary across services for incident correlation
  async getRecentErrorsForServices(serviceNames) {
    const errorLogsByService = {};
    for (const s of serviceNames) {
      const logs = await this.queryLogs({ service: s, onlyErrors: true, limit: 10 });
      errorLogsByService[s] = logs;
    }
    return errorLogsByService;
  }

  clearBuffer() {
    this.localLogBuffer = [];
  }
}

module.exports = new LokiAdapter();
