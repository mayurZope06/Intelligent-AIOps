# Standard Operating Procedure: Third-Party Payment Gateway Outage

## Identification & Symptoms
- **Alert Trigger**: `external_gateway_http_status >= 500` or `circuit_breaker_state == 'OPEN'`.
- **Primary Signals**: External Stripe API returns HTTP 503 Service Unavailable or network connection reset.
- **Cascading Symptoms**: `payment-service` circuit breaker trips to OPEN state; `order-service` aborts payments; customer checkout displays payment error.

## Root Cause Analysis
External third-party payment partner infrastructure is undergoing an unplanned outage, DNS failure, or TLS handshake degradation. Without graceful circuit breakers and multi-provider failover routing, all synchronous payment authorization attempts hang until socket timeout.

## Immediate Remediation Steps (SOP-07)
1. **Activate Secondary Payment Route / Gateway Failover**:
   - Flip traffic routing flag to redirect payment processing to secondary provider (e.g., PayPal / Adyen fallback):
   - Command: `POST /api/remediate { service: "payment-service", action: "failover_secondary_gateway" }`
2. **Reset Circuit Breaker**:
   - Once secondary provider route is active, reset circuit breaker from OPEN to HALF-OPEN for canary verification.
3. **Queue Delayed Authorizations**:
   - Switch non-urgent subscription checkouts to asynchronous background settlement queue.
4. **Verification**:
   - Verify external payment success rate returns to >99.5%.
   - Confirm circuit breaker transitions to CLOSED.
