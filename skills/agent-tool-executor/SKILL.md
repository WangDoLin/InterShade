---
name: agent-tool-executor
description: Supervise autonomous agent tool execution, zero-turn batching, dual-loop cycles, and permission safety gates.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/agent-executor
commitSha: d4e5f67890123456789abcdef0123456789a1b2c
compatibility:
  node: >=18.0.0
  intershade: >=2.1.0
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [tool_call, batch_dispatch, permission_gate]
tags: [agent, tool-calling, dual-loop, zero-turn, batching]
---

# Agent Tool Executor Skill

## Overview
This skill defines operational rules for autonomous tool execution, parallel dispatching, zero-turn batching, and strict permission gating within agent loops.

## Procedural Workflow

### Step 1: Pre-execution Safety Gating
1. Validate tool arguments against the Zod input schema.
2. Check tool permission profile via `ToolExecutionGate`:
   - If the tool is read-only, dispatch directly.
   - If the tool performs file mutations or command execution, verify workspace boundaries and explicit user consent policies.
3. Deny execution immediately if path arguments escape the workspace root.

### Step 2: Zero-Turn Batching & Parallel Dispatch
1. When multiple independent read operations are requested (e.g. inspecting 4 different files), combine them into a single batch using `ZeroTurnBatcher`.
2. Dispatch concurrent read tasks through `ParallelToolDispatcher` while respecting the concurrency limit.
3. Aggregate results and handle partial failures gracefully without terminating the turn prematurely.

### Step 3: Turn Budget & Loop Termination
1. Monitor cumulative turn payload size against the 10 MiB budget limit.
2. Monitor total tool invocations against the 32 calls per turn ceiling.
3. If budget thresholds are approached, issue a graceful continuation checkpoint to prevent memory bloat or socket timeout.
