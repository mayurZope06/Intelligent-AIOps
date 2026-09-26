const { GoogleGenerativeAI } = require('@google/generative-ai');
const ragEngine = require('../rag/ragEngine');
const logger = require('../utils/logger')('AIReasoning');

class AIReasoningEngine {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  }

  setApiKey(key) {
    this.apiKey = key;
    logger.info(`Gemini API key updated in reasoning engine`);
  }

  // Generate full Root Cause Analysis report
  async generateRCA(correlationResult) {
    const {
      overallSeverity,
      rootCauseCandidate,
      affectedServices,
      timeline,
      evidenceSnippets,
      anomalies
    } = correlationResult;

    logger.debug(`Starting AI RCA for candidate: ${rootCauseCandidate} with ${anomalies.length} anomalies`);

    // 1. Retrieve relevant Runbook documentation via RAG
    const queryContext = `${rootCauseCandidate} ${evidenceSnippets.join(' ')}`;
    const ragPassages = ragEngine.retrieveContext(queryContext, 2);
    const ragContextText = ragPassages.map(p => `[Runbook: ${p.docTitle} - ${p.sectionTitle}]\n${p.text}`).join('\n\n');
    logger.debug(`Retrieved ${ragPassages.length} RAG passages for context matching`);

    let rcaReport = null;
    let geminiError = null;

    // 2. Invoke Google Gemini LLM using actual collected evidence
    if (this.apiKey && this.apiKey !== 'mock_key' && !this.apiKey.startsWith('demo_')) {
      try {
        logger.info(`Dispatching diagnostic inference to Gemini API (model: ${this.modelName})...`);
        const genAI = new GoogleGenerativeAI(this.apiKey);

        const prompt = `
You are the Intelligent AIOps Engine, an expert incident diagnostic system for microservice architectures.
CRITICAL CONSTRAINT: You must base your diagnosis, evidence citations, and root cause analysis EXCLUSIVELY on the detected Prometheus anomalies, Loki logs, and retrieved operational runbooks provided below. Do NOT invent metric values, hypothetical symptoms, or placeholder evidence.

## Architecture & Dependency Topology:
Client (5173) -> API Gateway (4000) -> [Auth (4003), Order (4001)] -> [Inventory (4004), Payment (4002)] -> MongoDB Cluster (27017)

## Suspected Root Node:
${rootCauseCandidate}

## Detected Telemetry Anomalies (from Prometheus):
${JSON.stringify(anomalies, null, 2)}

## Supporting Telemetry & Log Evidence (from Loki/Prometheus):
${evidenceSnippets.join('\n') || 'No specific error log lines captured.'}

## Chronological Event Timeline:
${timeline.map(t => `- [${t.timestamp}] [${t.service}] [${t.source}]: ${t.summary}`).join('\n')}

## Retrieved Operational Runbooks (RAG Context):
${ragContextText || 'No specific runbook match.'}

Synthesize these real observations and return ONLY a valid JSON object matching this schema:
{
  "incidentSummary": "1-2 sentence factual summary of what is happening in the cluster based strictly on the metrics",
  "severity": "${overallSeverity}",
  "probableRootCause": "Factual explanation of the root cause based strictly on the telemetry evidence",
  "confidence": 92,
  "confidenceReasoning": "Technical reasoning connecting the observed anomalies to this conclusion",
  "affectedServices": {
    "root": "${rootCauseCandidate}",
    "cascading": ${JSON.stringify(affectedServices.cascading || [])},
    "impact": "Factual description of client or downstream impact"
  },
  "alternativeCauses": [
    "Alternative technical hypothesis 1",
    "Alternative technical hypothesis 2"
  ],
  "supportingEvidence": [
    "Direct citation of observed metric anomaly or log line"
  ],
  "retrievedKnowledge": {
    "runbookTitle": "${ragPassages[0] ? ragPassages[0].docTitle : 'Standard Operational Procedure'}",
    "guidanceSummary": "Actionable guidance extracted from runbook"
  },
  "timeline": [
    { "time": "ISO time", "service": "Service name", "event": "Event summary", "type": "origin" }
  ],
  "remediation": {
    "title": "Actionable remediation title",
    "description": "Concrete step-by-step resolution command or procedure",
    "command": "POST /api/remediate { service: \\"${rootCauseCandidate}\\", action: \\"restart_service\\" }",
    "actionType": "restart_service",
    "requiresHumanApproval": true
  }
}

CRITICAL JSON FORMATTING RULES:
1. Return ONLY a single, valid JSON object matching the schema above.
2. Use single quotes for any names, metrics, or values inside strings (e.g. 'metric_name' or 'status'). NEVER use unescaped double quotes inside strings.
3. Do not include raw unescaped newlines inside strings; keep strings on a single line or use \\n.
4. Output raw JSON only. Do not wrap in markdown tags.
`;

        const executeInference = async (modelName = this.modelName, temp = 0.2) => {
          const genModel = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: {
              temperature: temp,
              topP: 0.8,
              maxOutputTokens: 8192,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 0 }
            }
          });
          const result = await genModel.generateContent(prompt);
          const responseText = result.response.text();
          let cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
          const firstBrace = cleanJson.indexOf('{');
          const lastBrace = cleanJson.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
          }
          try {
            return JSON.parse(cleanJson);
          } catch (parseErr) {
            logger.error(`[AI Reasoning] JSON parse failed at error: ${parseErr.message}. Sample around position 600:\n${cleanJson.slice(550, 700)}`);
            throw parseErr;
          }
        };

        const candidateModels = [
          this.modelName,
          'gemini-2.5-flash-lite',
          'gemini-3.1-flash-lite',
          'gemini-3.5-flash-lite',
          'gemini-2.5-flash'
        ].filter((v, i, a) => a.indexOf(v) === i);
        let usedModel = this.modelName;

        for (const candidate of candidateModels) {
          try {
            rcaReport = await executeInference(candidate, 0.2);
            usedModel = candidate;
            break;
          } catch (modelErr) {
            geminiError = modelErr.message;
            logger.warn(`[AI Reasoning] Inference with ${candidate} encountered error (${modelErr.message}). Retrying with next model...`);
            await new Promise(r => setTimeout(r, 1200));
          }
        }

        if (rcaReport) {
          rcaReport.provider = 'Google Gemini LLM';
          rcaReport.model = usedModel;
        }
      } catch (err) {
        geminiError = err.message;
        logger.error(`[AI Reasoning] Gemini API call failed: ${err.message}`);
      }
    } else {
      geminiError = 'Gemini API key is not configured in settings.';
    }

    // Explicit error state if Gemini API is unavailable (NO mock fallback per requirements)
    if (!rcaReport) {
      throw new Error(`Gemini RCA failed: ${geminiError || 'Inference error'}. Configure valid GEMINI_API_KEY to generate real root cause analysis.`);
    }

    return {
      rca: rcaReport,
      ragPassages,
      correlation: correlationResult
    };
  }

  // Purely data-driven causal analysis derived from the actual dependency topology and live anomalies
  generateTopologicalCausalInference(correlation, ragPassages, diagnosticNote) {
    const { rootCauseCandidate, affectedServices, evidenceSnippets, anomalies, timeline, overallSeverity } = correlation;
    
    // Construct factual summary from real anomaly data
    const anomalyDescriptions = anomalies.map(a => `${a.service}: ${a.metric} (${a.description})`).join('; ');
    const primaryAnomaly = anomalies.find(a => a.service === rootCauseCandidate) || anomalies[0];

    const structuredTimeline = timeline.slice(0, 8).map((t, idx) => ({
      time: t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : `T+${idx * 2}s`,
      service: t.service,
      event: t.summary,
      type: t.service === rootCauseCandidate ? 'origin' : 'cascade'
    }));

    const matchedRunbook = ragPassages[0] || null;

    // Tailor remediation to the actual observed failure mode
    let remediation = {
      title: `Restart and Healthcheck ${rootCauseCandidate}`,
      description: `Restart service container and verify health probes against Prometheus.`,
      command: `POST /api/remediate { service: "${rootCauseCandidate}", action: "restart_service" }`,
      actionType: 'restart_service',
      requiresHumanApproval: true
    };

    if (primaryAnomaly) {
      const metric = primaryAnomaly.metric;
      if (metric === 'payment_db_errors_total' || metric === 'payment_active_connections') {
        remediation = {
          title: 'Drain & Reset Payment Connection Pool (SOP-01)',
          description: 'Flush exhausted sockets on payment-service, drain connection pool, and restore baseline headroom.',
          command: `POST /api/remediate { service: "payment-service", action: "restart_connection_pool" }`,
          actionType: 'restart_connection_pool',
          requiresHumanApproval: true
        };
      } else if (metric === 'payment_failure_mode') {
        remediation = {
          title: 'Clear Fault Injection & Reset Payment Service',
          description: 'Reset active failure simulation state and restore healthy transaction processing.',
          command: `POST /api/remediate { service: "payment-service", action: "reset_fault" }`,
          actionType: 'reset_fault',
          requiresHumanApproval: true
        };
      } else if (metric === 'gateway_failure_mode' || metric === 'gateway_checkout_errors_total' || metric === 'gateway_upstream_errors_total') {
        remediation = {
          title: 'Flush Ingress Cache & Reset API Gateway (SOP-03)',
          description: 'Flush route caches, reset upstream error counters, and restore healthy proxy pass on API Gateway.',
          command: `POST /api/remediate { service: "gateway-service", action: "flush_cache" }`,
          actionType: 'flush_cache',
          requiresHumanApproval: true
        };
      } else if (metric === 'order_failure_mode' || metric === 'order_downstream_payment_errors_total') {
        remediation = {
          title: 'Reset Order Circuit Breaker & Flush Saga Queue (SOP-04)',
          description: 'Reset cascading circuit breaker on order-service and restore upstream checkout pipeline.',
          command: `POST /api/remediate { service: "order-service", action: "reset_circuit_breaker" }`,
          actionType: 'reset_circuit_breaker',
          requiresHumanApproval: true
        };
      } else if (metric === 'auth_failure_total') {
        remediation = {
          title: 'Flush Auth Token Cache & Rotate JWT Keys',
          description: 'Clear expired token verification storm and flush auth credentials cache.',
          command: `POST /api/remediate { service: "auth-service", action: "flush_cache" }`,
          actionType: 'flush_cache',
          requiresHumanApproval: true
        };
      } else if (metric === 'inventory_failures_total' || metric === 'inventory_available_quantity') {
        remediation = {
          title: 'Replenish Inventory SKU Stock & Release Allocation Locks',
          description: 'Release locked stock allocations and restore catalog item quantities to baseline.',
          command: `POST /api/remediate { service: "inventory-service", action: "replenish_stock" }`,
          actionType: 'replenish_stock',
          requiresHumanApproval: true
        };
      } else if (metric === 'service_liveness_probe' || metric === 'up') {
        remediation = {
          title: `Restart Container Lifecycle for ${rootCauseCandidate}`,
          description: `Microservice process unreachable in Prometheus. Trigger container restart and verify health probe.`,
          command: `POST /api/remediate { service: "${rootCauseCandidate}", action: "restart_container" }`,
          actionType: 'restart_container',
          requiresHumanApproval: true
        };
      }
    }

    return {
      incidentSummary: `Service impairment detected originating in ${rootCauseCandidate}. Telemetry shows: ${primaryAnomaly ? primaryAnomaly.description : anomalyDescriptions || 'unresponsive service endpoint'}.`,
      severity: overallSeverity,
      probableRootCause: `Service ${rootCauseCandidate} is the deepest dependency exhibiting failure in the call chain. Active anomaly: ${primaryAnomaly ? primaryAnomaly.description : 'Failed telemetry probe'}.`,
      confidence: 88,
      confidenceReasoning: `Topological graph traversal identified ${rootCauseCandidate} as upstream causal origin based on service dependency depth and failure propagation order.`,
      affectedServices: {
        root: rootCauseCandidate,
        cascading: affectedServices.cascading || [],
        impact: affectedServices.cascading?.length > 0 
          ? `Cascading failure propagating to upstream services: ${affectedServices.cascading.join(', ')}`
          : `Direct service degradation on ${rootCauseCandidate}`
      },
      alternativeCauses: [
        'Transient network connectivity or DNS resolution failure',
        'Downstream infrastructure dependency or host resource exhaustion'
      ],
      supportingEvidence: evidenceSnippets.length > 0 ? evidenceSnippets : ['Probe failed on service port'],
      retrievedKnowledge: {
        runbookTitle: matchedRunbook ? matchedRunbook.docTitle : 'Standard Troubleshooting Procedure',
        guidanceSummary: matchedRunbook ? `${matchedRunbook.sectionTitle}: ${matchedRunbook.text.substring(0, 180)}...` : 'Inspect host process status and verify network connectivity.'
      },
      timeline: structuredTimeline,
      remediation,
      provider: 'Topological Causal Engine (Deterministic)',
      diagnosticNote: diagnosticNote ? `AI LLM Note: ${diagnosticNote}` : null
    };
  }
}

module.exports = new AIReasoningEngine();
