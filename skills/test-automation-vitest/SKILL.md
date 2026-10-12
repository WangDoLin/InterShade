---
name: test-automation-vitest
description: Orchestrate test suites, reproduce bugs with minimal red repro tests, and verify patches using Vitest and Node test runners.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/anthropics/skills/tree/main/skills/webapp-testing
commitSha: 7b2c9e1054321fedcba9876543210fedcba98765
compatibility:
  node: >=18.0.0
  intershade: >=2.1.0
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_write, bash_exec, test_runner]
tags: [testing, vitest, red-green, regression, verification]
---

# Test Automation Vitest Skill

## Overview
This skill guides the creation and execution of automated regression tests, ensuring reliable reproduction of reported defects and rigorous green-verification before changes are committed.

## Procedural Workflow

### Step 1: Red Repro Test Construction
1. Create a minimal reproduction test file isolated from external network dependencies.
2. Formulate explicit assertions targeting the exact defect boundary:
   - Input boundary conditions.
   - Unexpected throw or rejection.
   - Faulty state mutation.
3. Run the repro test and confirm it fails (RED) for the expected root-cause reason, not due to missing fixtures or syntax errors.

### Step 2: Test Isolation & Fixture Management
1. Use isolated test context with distinct session IDs to avoid crosstalk between tests.
2. Clean up temporary files, mocks, and environment variables in `afterEach` or `afterAll` hooks.
3. Do not rely on shared global state.

### Step 3: Green Verification & Invariant Checking
1. After applying the code patch, execute the test suite again.
2. Confirm the reproduction test passes (GREEN).
3. Execute adjacent regression test suites to guarantee zero unintended regressions.
4. Record test execution duration, memory allocation, and exit code for the proof attestation report.
