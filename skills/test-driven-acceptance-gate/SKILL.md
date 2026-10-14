---
name: test-driven-acceptance-gate
description: Enforce rigorous acceptance criteria and executable test cases before writing implementation code to guarantee zero regressions.
license: Apache-2.0
version: 1.0.0
author: InterShader Team
capabilities:
  scriptExecution: true
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, run_shell_command]
tags: [testing, tdd, acceptance, verification, quality-gate]
---

# Test-Driven Acceptance Gate Skill

## Overview
This skill operationalizes Test-Driven Development (TDD) and Princeton SWE acceptance gating. It strictly mandates writing failing tests first before modifying production code, eliminating "it worked on my machine" assumptions.

## Procedural Workflow

### Phase 1: Define Acceptance Criteria (Gherkin/Checklist)
1. Formulate Given-When-Then criteria for each functional requirement.
2. Formulate explicit negative test cases (Invalid input, empty payload, unauthorized request, timeout).

### Phase 2: Red Phase (Write Failing Reproduction Test)
1. Write a targeted test file in `tests/` verifying the new feature or reproducing the reported bug.
2. Run the test:
   ```bash
   npx vitest run tests/my-feature.test.ts
   # OR
   npx tsx tests/my-repro.ts
   ```
3. **MANDATORY GATE**: The test MUST fail with the expected error message. If it passes before code changes, the test is invalid.

### Phase 3: Green Phase (Minimal Surgical Implementation)
1. Write the minimal production code necessary to satisfy the test assertions.
2. Avoid over-engineering or anticipatory refactoring during this phase.
3. Re-run the test to confirm it turns **GREEN (PASS)**.

### Phase 4: Refactor & Invariant Check
1. Clean up variable names, extract helper functions (keeping functions under 50 lines).
2. Run the full test suite (`npm test` and `npm run typecheck`) to ensure zero regressions in adjacent components.
