---
name: cicd-deployment-orchestrator
description: Automate CI/CD validation, release verification, deployment runbook execution, and guaranteed rollback procedures.
license: Apache-2.0
version: 1.0.0
author: InterShader Release Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/cicd-orchestrator
commitSha: f67890123456789abcdef0123456789a1b2c3d4e5
compatibility:
  node: >=18.0.0
  intershade: >=2.1.0
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [git_ops, test_runner, linter, runbook_executor]
tags: [cicd, deployment, release, runbook, rollback, verification]
---

# CI/CD Deployment Orchestrator Skill

## Overview
This skill guides the release lifecycle, enforcing continuous integration quality gates, reproducible build validation, pre-flight health checks, and deterministic rollback mechanisms.

## Procedural Workflow

### Step 1: Pre-Flight Verification Gate
1. Validate Git working tree status:
   - Ensure working tree is clean with zero uncommitted changes.
   - Verify HEAD commit matches expected release tag.
2. Run automated validation checks:
   - TypeScript compilation check (`npm run typecheck`).
   - Unit and integration regression suites (`npm test`).
   - Security audit verification on all registered skills.
3. Fail immediately and halt deployment if any validation check fails.

### Step 2: Reproducible Artifact Build & Attestation
1. Build distribution package (`npm run build`).
2. Generate SHA-256 digest of built artifacts (`dist/`).
3. Compare artifact digest against signed release manifest.
4. Record build provenance and dependencies into `skills.lock.json`.

### Step 3: Deployment Runbook Execution & Rollback Invariant
1. Execute phased deployment steps defined in `DEPLOYMENT_RUNBOOK.md`.
2. Perform post-deployment smoke test verifying health endpoint.
3. If smoke test encounters failure or latency exceeds SLA:
   - Trigger automated rollback invariant: revert allowlist to previous approved snapshot, purge runtime cache, and restore prior artifact version.
   - Record incident telemetry and issue post-mortem report.
