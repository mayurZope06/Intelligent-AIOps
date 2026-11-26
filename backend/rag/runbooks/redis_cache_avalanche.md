# Standard Operating Procedure: Redis Cache Avalanche & Eviction Storm

## Identification & Symptoms
- **Alert Trigger**: `redis_memory_utilization_ratio > 0.90` or `redis_evictions_per_sec > 1000`.
- **Primary Signals**: Redis returns `OOM command not allowed when used memory > 'maxmemory'`.
- **Cascading Symptoms**: `auth-service` token validation latency spikes >800ms due to database cache miss fallback; API Gateway ingress queue stalls with HTTP 504 timeouts.

## Root Cause Analysis
Cache stampede and memory exhaustion occur when large volumes of TTL-synchronized user sessions expire simultaneously, coupled with unchecked write rate to the Redis in-memory store. Once `maxmemory` threshold is breached without appropriate `volatile-lru` or `allkeys-lru` eviction policy, Redis drops lookup keys and blocks incoming reads.

## Immediate Remediation Steps (SOP-05)
1. **Eviction Policy Tuning & Cache Flush**:
   - Flush transient session keys and adjust eviction policy to `volatile-lru`.
   - Command: `POST /api/remediate { service: "cache-redis", action: "flush_and_tune_lru" }`
2. **Scale In-Memory Allocation**:
   - Increase Redis memory limits by 100% or enable Redis Cluster key sharding across nodes.
3. **Add Jitter to Session TTLs**:
   - Configure a randomized ±15% jitter to authentication token TTLs to prevent synchronized avalanche expiration.
4. **Verification**:
   - Ensure cache hit-rate recovers above 92%.
   - Verify `auth-service` session validation latency returns to <15ms.
