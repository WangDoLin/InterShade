---
name: git-workflow-pro
description: Execute advanced Git operations, Conventional Commits, interactive rebases, branch strategies, and safe conflict resolutions.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/git-workflow-pro
commitSha: a6b7c8d9e0123456789abcdef012345a6b7c8d9e
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, run_shell_command, grep_search]
tags: [git, version-control, commits, rebase, branching, workflow, conflicts]
---

# Git Workflow Pro Skill

## Overview
This skill establishes standardized engineering protocols for version control, atomic commits, branch isolation, clean history maintenance, and deterministic merge conflict resolutions.

## Procedural Workflow

### Step 1: Branch Management & Isolation
1. **Branch Naming Standard**:
   - `feat/<feature-name>`: New capabilities or functional additions.
   - `fix/<bug-description>`: Defect fixes, security patches, or error corrections.
   - `refactor/<module-name>`: Code restructuring without altering external observable behavior.
   - `perf/<optimization>`: Performance improvements and latency reductions.
2. **Branch Invariant**:
   - Never commit directly to `main` / `master`. Always develop on dedicated topic branches and integrate via Pull Requests.

### Step 2: Atomic Commits & Conventional Commits Specification
1. **Atomic Commits Principle**:
   - Each commit MUST perform exactly one logical change.
   - Never combine refactoring, unrelated fixes, and new features into a single monolithic commit.
2. **Message Formatting**:
   - Format: `<type>(<optional scope>): <imperative summary>`
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
   - Use lowercase, imperative present tense ("add feature" not "added feature").
   - Maximum 72 characters for header line.

### Step 3: Clean History Maintenance & Interactive Rebase
1. **Rebasing Protocol**:
   - Prefer `git rebase` over repetitive merge commits to maintain linear project history.
   - Use interactive rebase (`git rebase -i HEAD~N`) to squash checkpoint commits and clarify commit messages before opening Pull Requests.
2. **Safety Invariants**:
   - Never force push (`--force`) to shared, public, or protected branches (`main`, `master`).
   - Use `--force-with-lease` when updating remote topic branches to prevent overwriting colleague commits.

### Step 4: Deterministic Conflict Resolution
1. **Conflict Analysis**:
   - Inspect both `HEAD` (current branch) and incoming commit diffs thoroughly.
   - Understand the intent of both changes before deciding on resolution.
2. **Verification & Post-Resolution**:
   - After resolving conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`), always execute test suites and compilation checks (`npm run typecheck`, automated tests) BEFORE completing the rebase or commit.
