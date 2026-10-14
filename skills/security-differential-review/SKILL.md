---
name: security-differential-review
description: Perform deep security-focused diff audits on git changes, scanning for secret leaks, unsafe deserialization, authorization bypass, and side-channels.
license: Apache-2.0
version: 1.0.0
author: InterShader Security Guild
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: false
allowedTools: [file_read, grep_search, git_diff, repo_map]
tags: [security, audit, diff-review, vulnerability, secret-leak, sast]
---

# Security Differential Review Skill

## Overview
This skill provides a ruthless security-first lens for auditing git diffs prior to staging and committing. It applies Trail of Bits defensive engineering patterns to detect latent vulnerabilities in code changes.

## Audit Checklist for Code Diffs

### 1. Secret & Credential Exposure
- Search diff for strings matching API keys, AWS access keys, JWT signing secrets, or private keys.
- Ensure `.env*` files or sensitive configuration files are not added to git staging.
- Check that error logs or exceptions do not output credentials, session tokens, or PII.

### 2. Injection & Command Execution
- Check for `eval()`, `new Function()`, `vm.runInContext()`, or dynamic script execution.
- Check for shell injection: `child_process.exec()` with unescaped string interpolation.
  - Fix: Always use `child_process.execFile()` or `spawn()` with an array of arguments.
- Check SQL injection: Direct template literal queries without parameterized bindings (`?` or `$1`).

### 3. Authentication & Authorization Boundaries
- Did any new HTTP routes get added without auth middleware?
- Are IDOR (Insecure Direct Object References) prevented by validating that the authenticated user owns the resource?

### 4. Input Sanitization & Deserialization
- Never trust client inputs: Validate incoming payloads with Zod schemas.
- Check for prototype pollution in recursive merge or deep clone utilities.
- Ensure HTML content rendered to UI is sanitized against Cross-Site Scripting (XSS).

### Verdict Formulation
Generate a markdown audit report:
- `FINDINGS_COUNT`: Total count of security findings.
- `RISK_LEVEL`: CRITICAL | HIGH | MEDIUM | LOW | CLEAN.
- `REMEDIATION_PLAN`: Explicit code replacement chunks for each security flaw detected.
