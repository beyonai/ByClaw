// 仅翻译示例说明；命令、路径、JSON 字段与状态值遵循同一集成测试契约。
export const E2E_RESULT_DIR_TREE_EN = `$BYCLAW_E2E_RESULT_DIR/        # Result root injected by the platform (unique per branch and run)
├── status.json      # Source of truth: status, totals, and failures (write atomically last)
├── reports/         # JUnit XML from each suite, including individual failures
│   └── <suiteId>.xml
├── logs/            # Checkout, build, deployment, and suite logs
│   └── <suiteId>.log
└── artifacts/       # Failure evidence (screenshots, videos, traces)
    └── <suiteId>/           # One directory per suite to avoid filename collisions
        ├── <caseId>.png     # Screenshot: filename equals case ID for failure association
        ├── <caseId>.webm    # Video (optional)
        └── <caseId>.zip     # Playwright trace (optional)`;

export const E2E_STATUS_JSON_EN = `{
  "schemaVersion": 1,
  "status": "running",          // See the fixed status values below
  "startedAt":  "2026-07-27T09:30:00+08:00",
  "updatedAt":  "2026-07-27T09:41:12+08:00",  // Optional: refresh during execution to show progress
  "finishedAt": null,           // Non-null only for terminal states
  "totals": { "total": 18, "passed": 15, "failed": 3, "skipped": 0 },
  "suites": [
    { "id": "suite-api", "status": "passed",  "report": "reports/suite-api.xml" },
    { "id": "suite-web", "status": "failed",  "report": "reports/suite-web.xml",
      "failedCases": [                        // Filled by the orchestrator from XML and artifacts; attach screenshots for failures
        { "case": "test_login", "artifacts": ["artifacts/suite-web/test_login.png"] }
      ] }
  ],
  "reason": "3 login tests failed: authentication headers missing in cross-module calls"  // Rejection reason; may be empty for non-failures
}`;

export const E2E_SCRIPT_SKELETON_EN = `#!/usr/bin/env bash
set -euo pipefail
DIR="$BYCLAW_E2E_RESULT_DIR"
mkdir -p "$DIR/reports" "$DIR/logs" "$DIR/artifacts"

# Write status atomically: write a temporary file, then rename it
write_status() { echo "$1" > "$DIR/status.json.tmp" && mv "$DIR/status.json.tmp" "$DIR/status.json"; }

write_status '{"schemaVersion":1,"status":"running","startedAt":"'"$(date -Is)"'"}'

# The orchestrator injects test accounts from environment settings; read environment variables without persisting credentials:
#   Sign in with "$E2E_ADMIN_USER" / "$E2E_ADMIN_PASS"   (prefix = envPrefix in environment settings)

# Run the suite and write JUnit XML to reports/
if pytest -q --junitxml="$DIR/reports/suite-api.xml" | tee "$DIR/logs/suite-api.log"; then
  write_status '{"schemaVersion":1,"status":"passed","finishedAt":"'"$(date -Is)"'"}'
else
  # Test failures -> failed (return to coder); build or environment failures before tests -> error
  write_status '{"schemaVersion":1,"status":"failed","finishedAt":"'"$(date -Is)"'","reason":"Test failures"}'
fi`;

export const E2E_SUITE_CONTRACT_EN = `# Suite authors handle four things; the orchestrator aggregates run status, so suites do not write status.json:

# 1) JUnit XML report (used to summarize pass rates and identify failed tests)
#    Write to the report path in the run command; the platform collects it at $BYCLAW_E2E_RESULT_DIR/reports/<suiteId>.xml
pytest -q --junitxml=report/junit.xml

# 2) Exit code semantics (used to determine suite success)
#    0     = All tests passed
#    Nonzero  = Test failures / execution errors

# 3) Standard output is the log, collected at $BYCLAW_E2E_RESULT_DIR/logs/<suiteId>.log

# 4) Failure evidence (screenshots recommended): write to the project directory; collected at artifacts/<suiteId>/
#    Name files by case ID (e.g. test_login.png); screenshots are associated with failed JUnit cases by filename.
#    - Playwright: use: { screenshot:'only-on-failure', video:'retain-on-failure', trace:'retain-on-failure' }
#    - pytest+selenium: In the failure hook: driver.save_screenshot(f"artifacts/{case_id}.png")
#    (Advanced) JUnit may also use [[ATTACHMENT|artifacts/<suiteId>/<caseId>.png]] to declare attachment paths explicitly`;

export const E2E_STATUS_ENUM_EN = [
  {
    code: 'pending',
    meaning: 'Not started (or status.json does not exist yet)',
  },
  {
    code: 'preparing',
    meaning: 'Preparing: checkout / image build / deployment',
  },
  {
    code: 'running',
    meaning: 'Tests running (finishedAt is null; becomes timeout if the maximum duration is exceeded)',
  },
  {
    code: 'passed',
    meaning: 'All tests passed → submit PR',
  },
  {
    code: 'failed',
    meaning: 'Test failures → return to coding',
  },
  {
    code: 'error',
    meaning: 'Build, deployment, or environment error before tests → return to coding or operations',
  },
  {
    code: 'timeout',
    meaning: 'Stopped after exceeding the maximum duration',
  },
  {
    code: 'cancelled',
    meaning: 'Cancelled manually',
  },
];
