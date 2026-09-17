# Standard Operating Procedure: High CPU & Resource Throttling

## Identification & Symptoms
- **Alert Trigger**: `payment_cpu_utilization_ratio > 0.85` (85% sustained CPU load) for > 1 minute.
- **Primary Signals**: Event loop lag metrics spike (> 500ms); process throughput drops sharply.
- **Cascading Symptoms**: Request queueing; elevated response times across dependent order transactions.

## Root Cause Analysis
High CPU utilization is caused by heavy cryptographic routines, unoptimized JSON serialization, or continuous garbage collection cycles due to memory pressure. In Node.js services, a saturated event loop halts asynchronous I/O dispatching.

## Immediate Remediation Steps (SOP-03)
1. **Scale Replicas & Redistribute Load**:
   - Command: `POST /api/remediate { action: "scale_service_replicas", replicas: 3 }`
2. **Throttle Compute Intensive Tasks**:
   - Throttle background batch processing and restore baseline CPU load:
   - Command: `POST /api/remediate { action: "reset_cpu_throttle" }`
3. **Capture Heap Snapshot & Profile**:
   - Trigger V8 cpuprofiler to identify hot code paths.
4. **Verification**:
   - Monitor CPU utilization gauge dropping back to < 30%.
