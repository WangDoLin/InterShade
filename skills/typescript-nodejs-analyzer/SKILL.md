---
name: typescript-nodejs-analyzer
description: Analyze, typecheck, lint, and diagnose TypeScript and Node.js codebases using AST inspection and compiler diagnostics.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/typescript-analyzer
commitSha: a3f89b4c2e1d7065983210456789abcdef012345
compatibility:
  node: >=18.0.0
  intershade: >=2.1.0
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: false
allowedTools: [file_read, grep_search, lsp_query, bash_read]
tags: [typescript, nodejs, ast, typecheck, diagnostics]
---

# TypeScript & Node.js Analyzer Skill

## Overview
This skill provides automated procedural guidelines for analyzing TypeScript and Node.js workspaces. It establishes static inspection workflows without running arbitrary external scripts.

## Procedural Workflow

### Step 1: Configuration & Module Resolution Inspection
1. Inspect `tsconfig.json` to verify:
   - `compilerOptions.target` and `compilerOptions.moduleResolution`.
   - `strict: true` settings and path aliases (`paths`).
   - `types` and `typeRoots` declarations to avoid unresolved ambient definitions.
2. Inspect `package.json`:
   - Verify `type: "module"` versus CommonJS configuration.
   - Verify dependencies, devDependencies, and workspace definitions.

### Step 2: Diagnostic & Typecheck Analysis
1. Execute static typechecking:
   - Run `tsc --noEmit` or equivalent compiler check in dry-run mode.
2. Group compiler diagnostics by category:
   - Module resolution errors (TS2307).
   - Property missing on type errors (TS2339).
   - Type assignment mismatches (TS2322, TS2345).

### Step 3: AST & Interface Compatibility Verification
1. Inspect public export interfaces and type definitions.
2. Ensure backward compatibility of exported methods and contracts.
3. Verify that all external types are imported with `import type` to support isolatedModules bundler treeshaking.
