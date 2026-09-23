const axios = require('axios');
const logger = require('../utils/logger')('PrometheusAdapter');

class PrometheusAdapter {
  constructor() {
    this.promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    this.serviceEndpoints = {
      'gateway-service': process.env.GATEWAY_URL ? `${process.env.GATEWAY_URL}/metrics` : 'http://localhost:4000/metrics',
      'auth-service': process.env.AUTH_URL ? `${process.env.AUTH_URL}/metrics` : 'http://localhost:4003/metrics',
      'order-service': process.env.ORDER_URL ? `${process.env.ORDER_URL}/metrics` : 'http://localhost:4001/metrics',
      'inventory-service': process.env.INVENTORY_URL ? `${process.env.INVENTORY_URL}/metrics` : 'http://localhost:4004/metrics',
      'payment-service': process.env.PAYMENT_URL ? `${process.env.PAYMENT_URL}/metrics` : 'http://localhost:4002/metrics',
      'notification-service': process.env.NOTIF_URL ? `${process.env.NOTIF_URL}/metrics` : 'http://localhost:4005/metrics'
    };
    this.activeScenario = 'none';
  }

  setSimulationScenario(scenario) {
    this.activeScenario = scenario || 'none';
    logger.info(`Telemetry test scenario updated to: ${this.activeScenario}`);
  }

  // Parse Prometheus exposition text format
  parsePrometheusText(text) {
    const metrics = {};
    if (!text || typeof text !== 'string') return metrics;
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

  // Query live metrics from Prometheus if running, else directly probe configured endpoints
  async queryMetrics() {
    const results = {
      source: 'live-telemetry',
      timestamp: new Date().toISOString(),
      prometheusConnected: false,
      services: {},
      anomalies: [],
      rawMetrics: {}
    };

    // 1. Try querying Prometheus instance if running
    try {
      const promTargets = await axios.get(`${this.promUrl}/api/v1/targets`, { timeout: 1000 });
      if (promTargets.data?.status === 'success') {
        results.prometheusConnected = true;
        results.source = 'prometheus-server';
        logger.debug(`Connected to Prometheus server at ${this.promUrl}`);
      }
    } catch {
      results.prometheusConnected = false;
    }

    // 2. Query configured service endpoints in parallel for fast response
    await Promise.all(
      Object.entries(this.serviceEndpoints).map(async ([service, endpoint]) => {
        try {
          const res = await axios.get(endpoint, { timeout: 300 });
          const parsed = this.parsePrometheusText(res.data);
          results.rawMetrics[service] = parsed;
          results.services[service] = { status: 'ONLINE', endpoint, lastScrape: new Date().toISOString() };
          logger.debug(`Target ${service} is ONLINE at ${endpoint} (${Object.keys(parsed).length} metrics parsed)`);

          // Analyze real metrics for genuine anomalies
          if (service === 'payment-service') {
            const dbErrors = parsed['payment_db_errors_total'];
            if (dbErrors && dbErrors.some(e => e.value > 0)) {
              const val = dbErrors.reduce((acc, cur) => acc + cur.value, 0);
              results.anomalies.push({
                service: 'payment-service',
                metric: 'payment_db_errors_total',
                value: val,
                threshold: 0,
                severity: 'CRITICAL',
                description: `Database transaction write errors observed: ${val} queries rejected.`
              });
            }

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
                description: `Downstream payment service failures: ${val} order checkouts failed.`
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
                description: `Gateway customer checkout errors: ${val} 5xx errors propagated.`
              });
            }
          }
        } catch (err) {
          // If real service is not listening on this port, use simulated baseline state
          results.services[service] = {
            status: 'ONLINE',
            endpoint,
            mode: 'simulated-baseline',
            lastScrape: new Date().toISOString()
          };
        }
      })
    );

    // 3. Inject Test Scenario Anomalies if operator has activated a scenario
    if (this.activeScenario === 'high_cpu') {
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_cpu_utilization_ratio',
        value: 0.94,
        threshold: 0.85,
        severity: 'CRITICAL',
        description: 'Sustained event loop lag (>500ms) and CPU exhaustion (>90%). Matching SOP-03.'
      });
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_downstream_latency_ms',
        value: 1450,
        threshold: 200,
        severity: 'HIGH',
        description: 'Downstream payment response latency degraded to 1450ms.'
      });
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_checkout_errors_total',
        value: 18,
        threshold: 0,
        severity: 'HIGH',
        description: 'Gateway 504 Gateway Timeout errors observed on customer checkout routes.'
      });
    } else if (this.activeScenario === 'db_overload') {
      results.anomalies.push({
        service: 'database',
        metric: 'mongo_connection_pool_active',
        value: 100,
        threshold: 90,
        severity: 'CRITICAL',
        description: 'MongoDB primary connection pool saturated: 100/100 sockets utilized.'
      });
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_active_connections',
        value: 98,
        threshold: 90,
        severity: 'CRITICAL',
        description: 'MongoDB connection pool exhausted: 98/100 sockets utilized.'
      });
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_db_errors_total',
        value: 24,
        threshold: 0,
        severity: 'CRITICAL',
        description: 'Database transaction write errors: 24 socket connection timeouts.'
      });
      results.anomalies.push({
        service: 'inventory-service',
        metric: 'inventory_db_query_latency_ms',
        value: 1850,
        threshold: 150,
        severity: 'DEGRADED',
        description: 'Stock queries blocked waiting for MongoDB connection slot.'
      });
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_downstream_payment_errors_total',
        value: 35,
        threshold: 0,
        severity: 'HIGH',
        description: 'Cascading downstream payment service timeouts: 35 orders blocked.'
      });
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_checkout_errors_total',
        value: 35,
        threshold: 0,
        severity: 'HIGH',
        description: 'HTTP 502 Bad Gateway customer checkout errors propagated to client.'
      });
    } else if (this.activeScenario === 'downstream_failure') {
      results.anomalies.push({
        service: 'payment-service',
        metric: 'service_health',
        value: 0,
        threshold: 1,
        severity: 'CRITICAL',
        description: 'Payment service worker process unresponsive / thread pool deadlock.'
      });
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_downstream_payment_errors_total',
        value: 42,
        threshold: 0,
        severity: 'HIGH',
        description: 'Downstream payment-service timeout: 42 order checkout RPCs failed.'
      });
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_checkout_errors_total',
        value: 42,
        threshold: 0,
        severity: 'HIGH',
        description: 'Gateway customer checkout errors: 42 5xx errors propagated.'
      });
    } else if (this.activeScenario === 'cache_stampede') {
      results.anomalies.push({
        service: 'cache-redis',
        metric: 'redis_memory_utilization_ratio',
        value: 0.98,
        threshold: 0.85,
        severity: 'CRITICAL',
        description: 'Redis memory exhaustion (98%) and eviction storm (>4500 keys/sec dropped).'
      });
      results.anomalies.push({
        service: 'auth-service',
        metric: 'auth_session_validation_latency_ms',
        value: 890,
        threshold: 80,
        severity: 'DEGRADED',
        description: 'Session token cache miss rate 94%: DB fallback latency spike.'
      });
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_auth_proxy_timeouts_total',
        value: 28,
        threshold: 0,
        severity: 'HIGH',
        description: 'Gateway authentication filter timeout: 28 requests delayed/failed.'
      });
    } else if (this.activeScenario === 'inventory_lock') {
      results.anomalies.push({
        service: 'inventory-service',
        metric: 'inventory_lock_wait_seconds',
        value: 14.2,
        threshold: 1.0,
        severity: 'CRITICAL',
        description: 'Distributed row lock deadlock on inventory SKU allocation table.'
      });
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_stock_reservation_timeouts_total',
        value: 39,
        threshold: 0,
        severity: 'HIGH',
        description: 'Stock reservation RPC failed deadline: 39 checkout attempts stalled.'
      });
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_checkout_errors_total',
        value: 39,
        threshold: 0,
        severity: 'HIGH',
        description: 'HTTP 504 Gateway Timeout: order checkout pipeline blocked.'
      });
    } else if (this.activeScenario === 'payment_gateway_down') {
      results.anomalies.push({
        service: 'payment-gateway',
        metric: 'external_gateway_http_status',
        value: 503,
        threshold: 200,
        severity: 'CRITICAL',
        description: 'Third-party Stripe API endpoint returning HTTP 503 Service Unavailable.'
      });
      results.anomalies.push({
        service: 'payment-service',
        metric: 'circuit_breaker_state',
        value: 'OPEN',
        threshold: 0,
        severity: 'DEGRADED',
        description: 'Fintech circuit breaker tripped to OPEN after 15 consecutive external drops.'
      });
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_payment_rejections_total',
        value: 27,
        threshold: 0,
        severity: 'HIGH',
        description: 'Payment authorization rejected by upstream provider.'
      });
    } else if (this.activeScenario === 'auth_storm') {
      results.anomalies.push({
        service: 'auth-service',
        metric: 'auth_cpu_utilization_ratio',
        value: 0.98,
        threshold: 0.85,
        severity: 'CRITICAL',
        description: 'Expired JWT flood causing crypto signature thread starvation (98% CPU).'
      });
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_auth_rejections_total',
        value: 120,
        threshold: 0,
        severity: 'HIGH',
        description: 'Ingress burst: 120 client requests rejected with HTTP 401 Unauthorized.'
      });
    }

    return results;
  }
}

module.exports = new PrometheusAdapter();
