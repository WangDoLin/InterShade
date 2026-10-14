---
name: documentation-auto-sync
description: Keep documentation, READMEs, API specifications, and architectural decision records synchronized with code refactoring and feature additions.
license: Apache-2.0
version: 1.0.0
author: InterShader Team
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search]
tags: [documentation, sync, readme, api-docs, adr, knowledge]
---

# Documentation Auto-Sync Skill

## Overview
This skill eliminates documentation drift. Whenever features, command-line arguments, API endpoints, or database configurations change, this skill identifies stale documentation files and automatically synchronizes them with the ground truth in code.

## Procedural Workflow

### Step 1: Detect Code Drift
1. Inspect modified files from git status or recent session commits:
   - CLI flags or commands changed in `cli/`?
   - API endpoints or schemas changed in `routes/` or `types/`?
   - Configuration options added or deprecated in `config/`?
2. Identify target documentation files:
   - `README.md` (root project overview and commands)
   - `docs/API.md` (API contracts and endpoint specs)
   - `docs/ARCHITECTURE.md` (component relationships and data flow)
   - `docs/adr/*.md` (Architectural Decision Records)

### Step 2: Formulate Precise Documentation Updates
1. **Preserve Integrity**: Do not rewrite unchanged documentation sections; make targeted edits.
2. **Update Code Samples**: Ensure code examples and curl/npm commands match the current implementation.
3. **Record Architectural Decisions**: If a major decision was made (e.g. switching to SQLite WAL or adding MCP), create a new ADR record:
   - Title: `docs/adr/NNNN-decision-title.md`
   - Context, Decision, Consequences, Status (Accepted).

### Step 3: Verification
1. Verify that all markdown links point to existing files or anchors.
2. Verify that markdown tables and syntax code blocks render cleanly.
