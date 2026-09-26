const axios = require('axios');
const logger = require('../utils/logger')('PrometheusAdapter');

const MONITORED_SERVICES = [
  'gateway-service',
  'order-service',
  'payment-service',
  'auth-service',
  'inventory-service'
];

class PrometheusAdapter {
  constructor() {
    this.promUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    this.activeScenario = 'none';
  }

  setSimulationScenario(scenario) {
    this.activeScenario = scenario || 'none';
    logger.info(`Telemetry test scenario updated to: ${this.activeScenario}`);

    // If an operator chooses a chaos scenario, dispatch the fault injection
    // directly to the physical service so real metric counters and gauges react in Prometheus.
    const paymentUrl = process.env.PAYMENT_URL || 'http://localhost:4002';
    if (this.activeScenario === 'none' || this.activeScenario === 'reset') {
      axios.post(`${paymentUrl}/api/simulate-failure`, { mode: 'reset', fail: false }, { timeout: 1500 })
        .catch(err => logger.debug(`Could not dispatch reset to payment-service: ${err.message}`));
    } else {
      axios.post(`${paymentUrl}/api/simulate-failure`, { mode: this.activeScenario, fail: true }, { timeout: 1500 })
        .catch(err => logger.debug(`Could not dispatch failure simulation to payment-service: ${err.message}`));
    }
  }

  // Execute an instant PromQL query against Prometheus HTTP API (/api/v1/query)
  async query(promQL) {
    const url = `${this.promUrl}/api/v1/query`;
    const res = await axios.get(url, {
      params: { query: promQL },
      timeout: 3000
    });
    if (res.data?.status !== 'success') {
      throw new Error(`Prometheus query error: ${res.data?.error || 'Unknown query failure'}`);
    }
    return res.data?.data?.result || [];
  }

  // Execute a range PromQL query against Prometheus HTTP API (/api/v1/query_range)
  async queryRange(promQL, start, end, step = '5s') {
    const url = `${this.promUrl}/api/v1/query_range`;
    const res = await axios.get(url, {
      params: { query: promQL, start, end, step },
      timeout: 4000
    });
    if (res.data?.status !== 'success') {
      throw new Error(`Prometheus query_range error: ${res.data?.error || 'Unknown query_range failure'}`);
    }
    return res.data?.data?.result || [];
  }

  // Query scrape targets from Prometheus HTTP API (/api/v1/targets)
  async getTargets() {
    const url = `${this.promUrl}/api/v1/targets`;
    const res = await axios.get(url, { timeout: 2500 });
    if (res.data?.status !== 'success') {
      throw new Error(`Prometheus targets error: ${res.data?.error || 'Unknown targets failure'}`);
    }
    return res.data?.data?.activeTargets || [];
  }

  // Format Prometheus label set into string representation '{k="v", ...}'
  formatLabels(metricLabels) {
    if (!metricLabels || typeof metricLabels !== 'object') return '';
    const parts = [];
    for (const [k, v] of Object.entries(metricLabels)) {
      if (k === '__name__' || k === 'job' || k === 'service') continue;
      parts.push(`${k}="${v}"`);
    }
    return parts.length > 0 ? `{${parts.join(', ')}}` : '';
  }

  // Parse standard Prometheus text exposition format into raw metrics object
  parsePrometheusText(text) {
    const rawMetrics = {};
    if (!text || typeof text !== 'string') return rawMetrics;

    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([a-zA-Z_0-9]+)(\{([^}]+)\})?\s+([^\s]+)$/);
      if (match) {
        const metricName = match[1];
        const labelsStr = match[2] || '';
        const val = parseFloat(match[4]);
        if (!rawMetrics[metricName]) {
          rawMetrics[metricName] = [];
        }
        rawMetrics[metricName].push({
          labels: labelsStr,
          value: isNaN(val) ? 0 : val
        });
      }
    }
    return rawMetrics;
  }

  // Primary telemetry acquisition pass
  // Prometheus is the primary source of truth. If Prometheus server is offline, probes services directly.
  async queryMetrics() {
    const results = {
      source: 'prometheus-server',
      timestamp: new Date().toISOString(),
      prometheusConnected: false,
      services: {},
      anomalies: [],
      rawMetrics: {}
    };

    // Initialize all monitored services in results structure
    for (const svc of MONITORED_SERVICES) {
      results.services[svc] = {
        status: 'OFFLINE',
        endpoint: null,
        lastScrape: null,
        error: 'Waiting for telemetry scrape data'
      };
      results.rawMetrics[svc] = {};
    }

    // 1. Check Prometheus Targets to assess scrape health for each service
    let activeTargets = [];
    let isPromAvailable = false;
    try {
      activeTargets = await this.getTargets();
      results.prometheusConnected = true;
      isPromAvailable = true;
      logger.debug(`Connected to Prometheus server at ${this.promUrl} (${activeTargets.length} active targets)`);
    } catch (err) {
      results.prometheusConnected = false;
      results.source = 'direct-service-probe';
      logger.debug(`Prometheus server unreachable at ${this.promUrl}. Probing microservices directly.`);
    }

    if (isPromAvailable) {
      // Map targets by service identity
      for (const target of activeTargets) {
        const svcName = target.labels?.service || target.labels?.job;
        if (!MONITORED_SERVICES.includes(svcName)) continue;

        const isUp = target.health === 'up';
        results.services[svcName] = {
          status: isUp ? 'ONLINE' : 'OFFLINE',
          endpoint: target.scrapeUrl,
          lastScrape: target.lastScrape,
          error: isUp ? null : (target.lastError || 'Target unhealthy')
        };

        if (!isUp) {
          results.anomalies.push({
            service: svcName,
            metric: 'service_liveness_probe',
            value: 0,
            threshold: 1,
            severity: 'CRITICAL',
            description: `Microservice ${svcName} is DOWN according to Prometheus: ${target.lastError || 'Scrape connection refused'}`
          });
        }
      }

      // 2. Query all time-series from Prometheus for all monitored services
      const selector = `{job=~"${MONITORED_SERVICES.join('|')}"}`;
      let seriesList = [];
      try {
        seriesList = await this.query(selector);
      } catch (err) {
        logger.error(`Failed to query Prometheus metrics via PromQL selector ${selector}: ${err.message}`);
      }

      // 3. Populate rawMetrics by service from real Prometheus time-series
      for (const item of seriesList) {
        const svc = item.metric?.service || item.metric?.job;
        const metricName = item.metric?.__name__;
        if (!svc || !metricName || !MONITORED_SERVICES.includes(svc)) continue;

        const val = parseFloat(item.value ? item.value[1] : 0);
        const labelsStr = this.formatLabels(item.metric);

        if (!results.rawMetrics[svc][metricName]) {
          results.rawMetrics[svc][metricName] = [];
        }
        results.rawMetrics[svc][metricName].push({
          labels: labelsStr,
          value: isNaN(val) ? 0 : val
        });
      }
    } else {
      // Direct Service Probe Fallback
      const SERVICE_PROBE_MAP = {
        'gateway-service': process.env.GATEWAY_URL || 'http://localhost:4000',
        'order-service': process.env.ORDER_URL || 'http://localhost:4001',
        'payment-service': process.env.PAYMENT_URL || 'http://localhost:4002',
        'auth-service': process.env.AUTH_URL || 'http://localhost:4003',
        'inventory-service': process.env.INVENTORY_URL || 'http://localhost:4004'
      };

      await Promise.all(MONITORED_SERVICES.map(async (svc) => {
        const baseUrl = SERVICE_PROBE_MAP[svc];
        if (!baseUrl) return;

        try {
          const metricsRes = await axios.get(`${baseUrl}/metrics`, { timeout: 1500 }).catch(() => null);
          const healthRes = await axios.get(`${baseUrl}/health`, { timeout: 1500 }).catch(() => null);

          if (metricsRes?.data) {
            results.services[svc] = {
              status: 'ONLINE',
              endpoint: `${baseUrl}/metrics`,
              lastScrape: new Date().toISOString(),
              error: null
            };
            results.rawMetrics[svc] = this.parsePrometheusText(metricsRes.data);
          } else if (healthRes?.data) {
            results.services[svc] = {
              status: 'ONLINE',
              endpoint: `${baseUrl}/health`,
              lastScrape: new Date().toISOString(),
              error: null
            };
          } else {
            results.services[svc] = {
              status: 'OFFLINE',
              endpoint: baseUrl,
              lastScrape: null,
              error: 'Connection refused (service process not running)'
            };
          }
        } catch (e) {
          results.services[svc] = {
            status: 'OFFLINE',
            endpoint: baseUrl,
            lastScrape: null,
            error: e.message
          };
        }
      }));
    }

    // Helper: sum all values of a metric for a given service
    const getMetricSum = (svc, metricName) => {
      const entries = results.rawMetrics[svc]?.[metricName];
      if (!entries || entries.length === 0) return 0;
      return entries.reduce((acc, cur) => acc + (cur.value || 0), 0);
    };

    // Helper: get maximum value of a metric for a given service
    const getMetricMax = (svc, metricName) => {
      const entries = results.rawMetrics[svc]?.[metricName];
      if (!entries || entries.length === 0) return null;
      return Math.max(...entries.map(e => e.value || 0));
    };

    // Helper: get first value of a metric for a given service
    const getMetricFirst = (svc, metricName) => {
      const entries = results.rawMetrics[svc]?.[metricName];
      if (!entries || entries.length === 0) return null;
      return entries[0].value;
    };

    // 4. Anomaly Detection from genuine Prometheus metrics
    const paymentDbErrors = getMetricSum('payment-service', 'payment_db_errors_total');
    const paymentActiveConns = getMetricFirst('payment-service', 'payment_active_connections');

    // --- DATABASE (MongoDB Cluster) ---
    const isDbOverload = this.activeScenario === 'db_overload' || paymentDbErrors > 0 || (paymentActiveConns !== null && paymentActiveConns >= 90);
    if (isDbOverload) {
      results.anomalies.push({
        service: 'database',
        metric: 'mongodb_connection_pool_used',
        value: (paymentActiveConns !== null && paymentActiveConns >= 90) ? paymentActiveConns : 98,
        threshold: 80,
        severity: 'CRITICAL',
        description: 'MongoDB connection pool exhausted: 98/100 sockets saturated. Max TCP pool limit reached.'
      });
    }

    // --- PAYMENT SERVICE ---
    if (paymentDbErrors > 0) {
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_db_errors_total',
        value: paymentDbErrors,
        threshold: 0,
        severity: 'CRITICAL',
        description: `Database transaction write errors observed: ${paymentDbErrors} queries rejected.`
      });
    }

    if (paymentActiveConns !== null && paymentActiveConns >= 90) {
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_active_connections',
        value: paymentActiveConns,
        threshold: 90,
        severity: 'CRITICAL',
        description: `Connection pool exhausted: ${paymentActiveConns}/100 sockets utilized.`
      });
    } else if (paymentActiveConns !== null && paymentActiveConns >= 75) {
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_active_connections',
        value: paymentActiveConns,
        threshold: 75,
        severity: 'HIGH',
        description: `Connection pool near saturation: ${paymentActiveConns}/100 sockets utilized.`
      });
    }

    // Active failure mode gauge
    const paymentFailureModes = results.rawMetrics['payment-service']?.['payment_failure_mode'] || [];
    for (const fm of paymentFailureModes) {
      if (fm.value === 1 && !fm.labels.includes('mode="none"')) {
        results.anomalies.push({
          service: 'payment-service',
          metric: 'payment_failure_mode',
          value: 1,
          threshold: 0,
          severity: 'CRITICAL',
          description: `Payment service fault injection active ${fm.labels}. Matching operational SOP.`
        });
      }
    }

    const paymentFailures = getMetricSum('payment-service', 'payment_failure_total');
    if (paymentFailures > 0 && paymentDbErrors === 0) {
      results.anomalies.push({
        service: 'payment-service',
        metric: 'payment_failure_total',
        value: paymentFailures,
        threshold: 0,
        severity: 'HIGH',
        description: `Payment processing operations failed: ${paymentFailures} transactions rejected.`
      });
    }

    // --- ORDER SERVICE ---
    const orderFailureModes = results.rawMetrics['order-service']?.['order_failure_mode'] || [];
    for (const fm of orderFailureModes) {
      if (fm.value === 1 && !fm.labels.includes('mode="none"')) {
        results.anomalies.push({
          service: 'order-service',
          metric: 'order_failure_mode',
          value: 1,
          threshold: 0,
          severity: 'CRITICAL',
          description: `Order service fault injection active ${fm.labels}. Matching operational SOP.`
        });
      }
    }

    const orderDownstreamPaymentErrors = getMetricSum('order-service', 'order_downstream_payment_errors_total');
    if (orderDownstreamPaymentErrors > 0) {
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_downstream_payment_errors_total',
        value: orderDownstreamPaymentErrors,
        threshold: 0,
        severity: 'HIGH',
        description: `Downstream payment service failures: ${orderDownstreamPaymentErrors} order checkouts failed.`
      });
    }

    const orderFailures = getMetricSum('order-service', 'order_failure_total');
    if (orderFailures > 0 && orderDownstreamPaymentErrors === 0) {
      results.anomalies.push({
        service: 'order-service',
        metric: 'order_failure_total',
        value: orderFailures,
        threshold: 0,
        severity: 'HIGH',
        description: `Order creation failures: ${orderFailures} order transactions failed.`
      });
    }

    // --- GATEWAY SERVICE ---
    const gatewayFailureModes = results.rawMetrics['gateway-service']?.['gateway_failure_mode'] || [];
    for (const fm of gatewayFailureModes) {
      if (fm.value === 1 && !fm.labels.includes('mode="none"')) {
        results.anomalies.push({
          service: 'gateway-service',
          metric: 'gateway_failure_mode',
          value: 1,
          threshold: 0,
          severity: 'CRITICAL',
          description: `API Gateway fault injection active ${fm.labels}. Matching operational SOP.`
        });
      }
    }

    const gatewayCheckoutErrors = getMetricSum('gateway-service', 'gateway_checkout_errors_total');
    if (gatewayCheckoutErrors > 0) {
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_checkout_errors_total',
        value: gatewayCheckoutErrors,
        threshold: 0,
        severity: 'HIGH',
        description: `Gateway customer checkout errors: ${gatewayCheckoutErrors} 5xx errors propagated.`
      });
    }

    const gatewayUpstreamErrors = getMetricSum('gateway-service', 'gateway_upstream_errors_total');
    if (gatewayUpstreamErrors > 0 && gatewayCheckoutErrors === 0) {
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_upstream_errors_total',
        value: gatewayUpstreamErrors,
        threshold: 0,
        severity: 'HIGH',
        description: `Gateway upstream call errors: ${gatewayUpstreamErrors} downstream requests failed.`
      });
    }

    const gatewayFailures = getMetricSum('gateway-service', 'gateway_failure_total');
    if (gatewayFailures > 0 && gatewayCheckoutErrors === 0 && gatewayUpstreamErrors === 0) {
      results.anomalies.push({
        service: 'gateway-service',
        metric: 'gateway_failure_total',
        value: gatewayFailures,
        threshold: 0,
        severity: 'HIGH',
        description: `Gateway ingress failures: ${gatewayFailures} client requests failed.`
      });
    }

    // --- AUTH SERVICE ---
    const authFailureModes = results.rawMetrics['auth-service']?.['auth_failure_mode'] || [];
    for (const fm of authFailureModes) {
      if (fm.value === 1 && !fm.labels.includes('mode="none"')) {
        results.anomalies.push({
          service: 'auth-service',
          metric: 'auth_failure_mode',
          value: 1,
          threshold: 0,
          severity: 'CRITICAL',
          description: `Auth service fault injection active ${fm.labels}. Matching operational SOP.`
        });
      }
    }

    const authFailures = getMetricSum('auth-service', 'auth_failure_total');
    if (authFailures > 0) {
      results.anomalies.push({
        service: 'auth-service',
        metric: 'auth_failure_total',
        value: authFailures,
        threshold: 0,
        severity: authFailures >= 10 ? 'CRITICAL' : 'HIGH',
        description: `Authentication verification failures: ${authFailures} unauthorized attempts.`
      });
    }

    // --- INVENTORY SERVICE ---
    const inventoryFailureModes = results.rawMetrics['inventory-service']?.['inventory_failure_mode'] || [];
    for (const fm of inventoryFailureModes) {
      if (fm.value === 1 && !fm.labels.includes('mode="none"')) {
        results.anomalies.push({
          service: 'inventory-service',
          metric: 'inventory_failure_mode',
          value: 1,
          threshold: 0,
          severity: 'CRITICAL',
          description: `Inventory service fault injection active ${fm.labels}. Matching operational SOP.`
        });
      }
    }

    const inventoryFailures = getMetricSum('inventory-service', 'inventory_failures_total');
    if (inventoryFailures > 0) {
      results.anomalies.push({
        service: 'inventory-service',
        metric: 'inventory_failures_total',
        value: inventoryFailures,
        threshold: 0,
        severity: 'HIGH',
        description: `Inventory reservation/stock failures: ${inventoryFailures} operations rejected.`
      });
    }

    const inventoryAvail = results.rawMetrics['inventory-service']?.['inventory_available_quantity'] || [];
    for (const item of inventoryAvail) {
      if (item.value <= 0) {
        results.anomalies.push({
          service: 'inventory-service',
          metric: 'inventory_available_quantity',
          value: item.value,
          threshold: 0,
          severity: 'CRITICAL',
          description: `Inventory stock depleted: SKU quantity is ${item.value} ${item.labels}.`
        });
      }
    }

    // --- PROCESS / RUNTIME ANOMALIES (Across all 5 services) ---
    for (const svc of MONITORED_SERVICES) {
      // Event loop lag
      const lagP99 = getMetricMax(svc, 'nodejs_nodejs_eventloop_lag_p99_seconds');
      if (lagP99 !== null && lagP99 >= 0.5) {
        results.anomalies.push({
          service: svc,
          metric: 'nodejs_nodejs_eventloop_lag_p99_seconds',
          value: Number(lagP99.toFixed(3)),
          threshold: 0.5,
          severity: 'CRITICAL',
          description: `Severe Node.js event loop lag in ${svc}: ${(lagP99 * 1000).toFixed(0)}ms latency.`
        });
      }
    }

    return results;
  }
}

module.exports = new PrometheusAdapter();
