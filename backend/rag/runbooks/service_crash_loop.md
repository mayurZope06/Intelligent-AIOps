# Standard Operating Procedure: Service Crash Loop & Fatal Terminations

## Identification & Symptoms
- **Alert Trigger**: Container exit status `CrashLoopBackOff`, exit code `137` (OOM) or `139` (SIGSEGV).
- **Primary Signals**: Process unhandled exception or unhandled promise rejection logs.
- **Cascading Symptoms**: `ECONNREFUSED` reported by all upstream dependents trying to reach the service port.

## Root Cause Analysis
A crash loop occurs when a critical uncaught exception terminates the main worker process, triggering container orchestrator restart policies. If the initialization condition or inbound request reproduces the fault immediately, the pod cycles continuously.

## Immediate Remediation Steps (SOP-04)
1. **Restart Service & Drain Poison Pill Requests**:
   - Restart the target container and purge toxic queue messages:
   - Command: `POST /api/remediate { action: "restart_container" }`
2. **Rollback to Previous Stable Release**:
   - If crash began immediately post-deployment, trigger instant canary rollback.
3. **Verification**:
   - Confirm `/health` responds with HTTP 200 `HEALTHY`.
