# Standard Operating Procedure: Database Connection Pool Exhaustion

## Identification & Symptoms
- **Alert Trigger**: `payment_db_errors_total > 0` or `payment_active_connections == max_connections`.
- **Primary Signals**: MongoDB driver throws `E_CONN_POOL_EXHAUSTED` or `AcquireConnection timeout after 5000ms`.
- **Cascading Symptoms**: Downstream HTTP 503 Service Unavailable returned to Order Service; Gateway surfaces 502 Bad Gateway to checkout customers.

## Root Cause Analysis
Database connection pool exhaustion occurs when incoming concurrent payment transactions lease connections faster than the pool can release or return them to the idle queue. When all available sockets (max: 100) are saturated by unindexed queries or zombie connections, all pending transactions timeout waiting for an available socket.

## Immediate Remediation Steps (SOP-01)
1. **Drain & Reset Connection Pool**: Flush zombie sockets on `payment-service` by triggering the pool reset hook:
   - Command: `POST /api/remediate { action: "restart_connection_pool" }`
2. **Increase Connection Pool Ceilings**:
   - Update `MONGODB_POOL_MAX_SIZE` from 100 to 250 in payment service environment config.
3. **Enable Socket Keep-Alives & Idle Timeout**:
   - Set `maxIdleTimeMS=15000` and `waitQueueTimeoutMS=2500` to rapidly fail-fast rather than hanging upstream callers.
4. **Verification**:
   - Verify `payment_db_errors_total` stabilizes to 0.
   - Confirm healthy HTTP 200 responses on `/api/payments`.
