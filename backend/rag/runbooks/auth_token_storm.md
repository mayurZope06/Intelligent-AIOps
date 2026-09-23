# Standard Operating Procedure: Auth Token Verification Storm & CPU Throttling

## Identification & Symptoms
- **Alert Trigger**: `auth_cpu_utilization_ratio > 0.90` and `gateway_auth_rejections_total > 50`.
- **Primary Signals**: Event loop latency on `auth-service` exceeds 600ms; thread pool saturated with asymmetric cryptographic RSA signature validations.
- **Cascading Symptoms**: Gateway proxy rejects valid customer requests with HTTP 401 Unauthorized or 504 Timeout; mobile/web clients experience sudden logout.

## Root Cause Analysis
A malformed client retry loop, expired refresh token flood, or key rotation synchronization failure caused millions of invalid authentication tokens to be presented simultaneously. Intensive cryptographic signature verification (`jwt.verify` with RSA-256) consumes excessive CPU cycles, starving the Node.js event loop.

## Immediate Remediation Steps (SOP-08)
1. **Enable Token Rate-Limiting & Flush Ingress Throttler**:
   - Throttle client IP token renewal requests at API Gateway and enable short-term JWT verification caching:
   - Command: `POST /api/remediate { service: "auth-service", action: "rate_limit_and_cache_keys" }`
2. **Horizontal Worker Auto-Scaling**:
   - Scale `auth-service` replicas from 2 to 6 to distribute cryptographic verification load.
3. **PublicKey Caching**:
   - Cache JWKS public verification keys locally with 30-minute TTL to eliminate repetitive network retrieval.
4. **Verification**:
   - Verify `auth-service` CPU utilization drops below 40%.
   - Ensure 401 error rate returns to normal baseline (<0.1%).
