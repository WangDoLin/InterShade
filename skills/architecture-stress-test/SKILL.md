---
name: architecture-stress-test
description: Stress-test proposed software architecture before coding to detect circular dependencies, scalability cliffs, and security gaps.
license: Apache-2.0
version: 1.0.0
author: InterShader Team
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, grep_search, repo_map]
tags: [architecture, system-design, review, risk-analysis, resilience]
---

# Architecture Stress-Test Skill

## Overview
This skill acts as a hostile "second eye" on implementation plans and architectural proposals before any code is modified. It stresses the design against scale, failure modes, data consistency, and maintainability.

## Triggering Conditions
- After planning an architectural change or refactor.
- When introducing a new external service, database schema, or state machine.
- When deciding between two competing implementation approaches.
- Before committing to multi-file modifications.

## Procedural Stress-Testing Protocol

### Step 1: Boundary & Dependency Analysis
1. **Detect Circular Dependencies**:
   - Check if Module A calls Module B and Module B synchronously calls back into Module A.
   - Enforce unidirectional data flow: Controllers ➔ Services ➔ Repositories.
2. **Coupling vs Cohesion**:
   - Verify that changes in one domain do not force cascade edits in unrelated modules.
   - Flag any leaked database schemas or internal DTOs across API boundaries.

### Step 2: Failure Mode & Edge Case Stressing
1. **Network & I/O Timeouts**:
   - Does every external HTTP/RPC call have an explicit timeout and abort signal?
   - What happens if the downstream service returns HTTP 500, 502, or 429?
2. **State Machine Invariants**:
   - Can an operation get stuck in an intermediate `PENDING` state on process crash?
   - Are idempotent retries supported using idempotency keys?

### Step 3: Concurrency & Lock Contention
1. **Race Conditions**:
   - Check read-modify-write patterns: Are database rows or in-memory caches protected with transactions or atomic CAS (Compare-And-Swap)?
2. **Backpressure**:
   - What happens if 1,000 tasks are queued concurrently? Will Node.js memory spike or event loop lag exceed 50ms?

### Output Decision Format
Produce a structured verdict:
- 🔴 **BLOCKER**: Severe design flaw that will cause data loss, infinite loop, or outage. Must redesign.
- 🟡 **WARNING**: Fragile pattern or performance cliff. Requires explicit mitigation.
- 🟢 **APPROVED**: Sound architecture with clear error boundaries. Proceed with implementation.
