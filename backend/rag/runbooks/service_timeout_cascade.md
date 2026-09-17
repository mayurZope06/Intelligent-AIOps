# Standard Operating Procedure: Service Timeout & Cascading Latency

## Identification & Symptoms
- **Alert Trigger**: `order_http_request_duration_ms_bucket{le="2000"} < 0.8` or p95 latency > 3000ms.
- **Primary Signals**: Log messages indicating `timeout of 4000ms exceeded` on inter-service HTTP requests.
- **Cascading Symptoms**: API Gateway times out awaiting Order Service; thread pools become blocked waiting on synchronous downstream RPCs.

## Root Cause Analysis
Cascading failure typically starts in an edge or deep dependency (e.g. `payment-service` or external payment provider). Because upstream services (`order-service`, `gateway-service`) hold open client connections while awaiting responses without circuit breakers, client traffic rapidly exhausts server worker threads, leading to total gateway paralysis.

## Immediate Remediation Steps (SOP-02)
1. **Trip Circuit Breaker to Payment Service**:
   - Open circuit breaker on `order-service` to immediately fail fast and prevent thread starvation.
   - Command: `POST /api/remediate { action: "enable_circuit_breaker" }`
2. **Apply Upstream Timeout Reductions**:
   - Reduce upstream client read timeouts from 5000ms to 1500ms to unblock gateway threads.
3. **Clear Stalled Payment Workers**:
   - Command: `POST /api/remediate { action: "reset_service_latency" }`
4. **Verification**:
   - Verify Gateway p95 latency returns under 250ms.
