# InterShader Skill Aggregation & Deployment Preparation Plan

## 1. Executive Summary & Purpose

This document defines the architectural standards, ingestion pipeline, integrity verification, security controls, and deployment lifecycle for Agent Skills integrated into the InterShader platform.
Based on the open Agent Skills specification (agentskills.io), Anthropic Skills, Google Gemini CLI discovery tiers, Microsoft Agent Framework scopes, and Snyk Agent Scan static auditing rules, this subsystem transforms ad-hoc agent prompts into version-pinned, cryptographically attested, security-audited procedural capabilities.

## 2. Architecture & 3-Tier Discovery Model

InterShader discovers and resolves skills across three hierarchical tiers, evaluated in order of increasing precedence:

```text
+-----------------------------------------------------------+
| Tier 3: Workspace Skills (.intershader/skills, .agents/)  | (Highest Precedence)
+-----------------------------------------------------------+
                             |
+-----------------------------------------------------------+
| Tier 2: User / Global Skills (~/.intershader/skills)      |
+-----------------------------------------------------------+
                             |
+-----------------------------------------------------------+
| Tier 1: Built-in Catalog (skills/ in InterShader core)    | (Lowest Precedence)
+-----------------------------------------------------------+
```

When multiple skills share identical names, the higher precedence tier overrides lower tiers. All overrides are logged for traceability.

## 3. Standard Skill Format (SKILL.md Specification)

Every skill is a directory containing a required `SKILL.md` file and optional supporting assets:

```text
<skill-name>/
|-- SKILL.md                 # Required: YAML frontmatter + Markdown procedural instructions
|-- scripts/                 # Optional: Executable automation scripts
|-- references/              # Optional: In-depth schemas, specs, reference documentation
`-- assets/                  # Optional: Templates, fixtures, seed files
```

### 3.1 YAML Frontmatter Schema

```yaml
---
name: string               # Unique kebab-case identifier (e.g. typescript-nodejs-analyzer)
description: string        # Specific intent trigger and purpose (~50-100 words)
license: string            # SPDX license identifier (e.g. MIT, Apache-2.0)
version: string            # SemVer (e.g. 1.0.0)
author: string             # Upstream maintainer or organization
upstreamUrl: string        # Canonical Git repository or registry URL
commitSha: string          # Exact pinned Git commit SHA
compatibility:
  node: string             # Supported Node.js version range (e.g. >=18.0.0)
  intershade: string       # Compatible InterShader runtime version (e.g. >=2.1.0)
capabilities:
  scriptExecution: boolean # True only if script execution is strictly permitted
  networkAccess: boolean   # True only if external network access is required
  filesystemWrite: boolean # True only if write modifications are allowed
allowedTools: string[]     # Explicit tool whitelist required by this skill
tags: string[]             # Categorization tags
---
```

## 4. Cryptographic Provenance & Lockfile Standard

To prevent supply-chain attacks and upstream drift, every registered skill must be recorded in `skills.lock.json`:

```json
{
  "lockfileVersion": "1.0.0",
  "generatedAt": "2026-10-10T13:46:00Z",
  "skills": {
    "typescript-nodejs-analyzer": {
      "version": "1.0.0",
      "upstreamUrl": "https://github.com/agentskills/agentskills",
      "commitSha": "a1b2c3d4e5f67890123456789abcdef012345678",
      "license": "Apache-2.0",
      "contentSha256": "3d5f8...",
      "treeSha256": "8a7c2...",
      "capabilities": {
        "scriptExecution": false,
        "networkAccess": false,
        "filesystemWrite": false
      },
      "auditStatus": "PASSED"
    }
  }
}
```

### Invariant:
Any mismatch between computed `contentSha256` and the pinned lockfile entry triggers an immediate `INTEGRITY_VIOLATION` error and blocks skill activation.

## 5. Security Policy & Static Audit Guard (Snyk Agent Scan Model)

All skills undergo mandatory static analysis before admission to the allowlist (`skills.allowlist.json`).

### 5.1 Static Security Checks
1. **Prompt Injection & System Prompt Overrides**:
   - Detection of patterns such as `ignore previous instructions`, `bypass safety`, `disregard system constraints`, or instructions attempting to reveal underlying system tokens.
2. **Dangerous Script & Command Execution**:
   - Detection of unbounded shell execution (`rm -rf`, `format`, `dd`), eval commands, and remote code downloading (`curl ... | sh`).
   - If a skill specifies `capabilities.scriptExecution: false`, any presence of executable scripts in `scripts/` is flagged as a high-severity violation.
3. **Sensitive Credential & Secret Leakage**:
   - Flagging references to environment secrets (`process.env.OPENAI_API_KEY`, private tokens, credentials).
4. **Path Traversal & Filesystem Violations**:
   - Scanning for relative directory escapes (`../../`, absolute root path mutations).

### 5.2 Allowlist Enforcement (`skills.allowlist.json`)
Only skills explicitly approved in `skills.allowlist.json` with matching SHA-256 signatures can be activated at runtime. Unapproved skills are quarantined.

## 6. Progressive Disclosure & Context Window Management

To preserve model token budgets:
1. **Discovery Stage**: Only skill `name` and `description` (~100 tokens per skill) are exposed in the agent system catalog.
2. **Activation Stage**: When the agent requests `skill_activate`, the skill undergoes allowlist verification. If approved, the core markdown procedural instructions are injected into the context window.
3. **Execution Stage**: Secondary files in `references/` or `assets/` are loaded on-demand only when explicitly queried by tool calls.

## 7. Deployment Runbook & Rollback Procedure

- **Pre-deployment Verification**:
  1. `intershade skill verify`: Validate lockfile integrity.
  2. `intershade skill audit`: Run static security auditor on all skills.
  3. `npm test`: Run full regression suite.
- **Rollback Guarantee**:
  If any deployed skill causes unexpected degradation, the system can immediately revert by:
  1. Removing or quarantining the skill entry from `skills.allowlist.json`.
  2. Restoring `skills.lock.json` from git revision.
  3. Purging runtime skill cache.
