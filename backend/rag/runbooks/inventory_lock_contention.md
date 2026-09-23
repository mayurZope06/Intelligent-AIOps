# Standard Operating Procedure: Distributed Inventory Lock Deadlock

## Identification & Symptoms
- **Alert Trigger**: `inventory_lock_wait_seconds > 5.0` or `order_stock_reservation_timeouts_total > 10`.
- **Primary Signals**: Database driver throws `LockWaitTimeoutException: Deadlock found when trying to get lock for stock SKU allocation`.
- **Cascading Symptoms**: `order-service` checkout thread pool exhausted; Gateway returns 504 Gateway Timeout on user checkout submissions.

## Root Cause Analysis
Lock contention occurs during high-concurrency checkout traffic on hot SKU inventory records. When multiple distributed order transactions request exclusive row-level locks on the same product stock inventory without optimistic locking or strict lock acquisition ordering, cyclic wait dependencies cause deadlocks.

## Immediate Remediation Steps (SOP-06)
1. **Kill Hanging Lock Queries & Reset Allocation Queue**:
   - Terminate active deadlocked database queries and reset inventory reservation queue:
   - Command: `POST /api/remediate { service: "inventory-service", action: "release_locks_and_restart" }`
2. **Implement Optimistic Concurrency Control**:
   - Transition inventory table from pessimistic row locking (`SELECT FOR UPDATE`) to versioned optimistic updates (`UPDATE ... SET stock = stock - 1 WHERE version = @version`).
3. **Partition Hot Stock Buffers**:
   - Enable virtual stock sharding for high-velocity SKUs across multiple distributed partitions.
4. **Verification**:
   - Confirm `inventory_lock_wait_seconds` drops to <50ms.
   - Verify checkout transaction completion rate returns to 100%.
