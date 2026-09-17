const axios = require('axios');

class PrometheusAdapter {
  constructor() {
    this.promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    this.serviceEndpoints = {
      'gateway-service': 'http://localhost:4000/metrics',
      'order-service': 'http://localhost:4001/metrics',
      'payment-service': 'http://localhost:4002/metrics'
    };
  }

  // Parse Prometheus text format into key-value map
  parsePrometheusText(text) {
    const metrics = {};
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(\{.*?\})?\s+([0-9eE\.\+\-]+)$/);
      if (match) {
        const metricName = match[1];
        const labels = match[2] || '';
        const value = parseFloat(match[3]);
        if (!metrics[metricName]) metrics[metricName] = [];
        metrics[metricName].push({ labels, value });
      }
    }
    return metrics;
  }

  // Query metrics from Prometheus if running, else direct scrape services
  async queryMetrics() {
    const results = {
      source: 'live-telemetry',
      timestamp: new Date().toISOString(),
      anomalies: [],
      rawMetrics: {}
    };

    // Scrape services directly or query Prometheus
    for (const [service, endpoint] of Object.entries(this.serviceEndpoints)) {
      try {
        const res = await axios.get(endpoint, { timeout: 1500 });
        const parsed = this.parsePrometheusText(res.data);
        results.rawMetrics[service] = parsed;

        // Check for anomalies
        if (service === 'payment-service') {
          // 1. DB Errors
          const dbErrors = parsed['payment_db_errors_total'];
          if (dbErrors && dbErrors.some(e => e.value > 0)) {
            const val = dbErrors.reduce((acc, cur) => acc + cur.value, 0);
            results.anomalies.push({
              service: 'payment-service',
              metric: 'payment_db_errors_total',
              value: val,
              threshold: 0,
              severity: 'CRITICAL',
              description: `Database connection errors detected: ${val} errors recorded.`
            });
          }

          // 2. High CPU
          const cpuMetric = parsed['payment_cpu_utilization_ratio'];
          if (cpuMetric && cpuMetric[0] && cpuMetric[0].value > 0.8) {
            results.anomalies.push({
              service: 'payment-service',
              metric: 'payment_cpu_utilization_ratio',
              value: cpuMetric[0].value,
              threshold: 0.8,
              severity: 'HIGH',
              description: `CPU utilization spike: ${(cpuMetric[0].value * 100).toFixed(1)}% exceeds 80% threshold.`
            });
          }

          // 3. Connection Pool Saturation
          const poolMetric = parsed['payment_active_connections'];
          if (poolMetric && poolMetric[0] && poolMetric[0].value >= 90) {
            results.anomalies.push({
              service: 'payment-service',
              metric: 'payment_active_connections',
              value: poolMetric[0].value,
              threshold: 90,
              severity: 'CRITICAL',
              description: `Connection pool exhausted: ${poolMetric[0].value}/100 sockets utilized.`
            });
          }
        }

        if (service === 'order-service') {
          const downstreamErrors = parsed['order_downstream_payment_errors_total'];
          if (downstreamErrors && downstreamErrors.some(e => e.value > 0)) {
            const val = downstreamErrors.reduce((acc, cur) => acc + cur.value, 0);
            results.anomalies.push({
              service: 'order-service',
              metric: 'order_downstream_payment_errors_total',
              value: val,
              threshold: 0,
              severity: 'HIGH',
              description: `Cascading downstream payment failures: ${val} order checkout failures.`
            });
          }
        }

        if (service === 'gateway-service') {
          const gwErrors = parsed['gateway_checkout_errors_total'];
          if (gwErrors && gwErrors.some(e => e.value > 0)) {
            const val = gwErrors.reduce((acc, cur) => acc + cur.value, 0);
            results.anomalies.push({
              service: 'gateway-service',
              metric: 'gateway_checkout_errors_total',
              value: val,
              threshold: 0,
              severity: 'HIGH',
              description: `Gateway customer checkout errors: ${val} 5xx errors propagated to client.`
            });
          }
        }

      } catch (err) {
        // Service may be down or unreachable (e.g. crash loop)
        results.anomalies.push({
          service,
          metric: 'service_health',
          value: 0,
          threshold: 1,
          severity: 'CRITICAL',
          description: `Service ${service} unreachable or failed to respond to metrics scrape (${err.message})`
        });
      }
    }

    return results;
  }
}

module.exports = new PrometheusAdapter();
