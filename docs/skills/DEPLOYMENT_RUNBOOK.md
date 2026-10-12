# InterShader Agent Skills Deployment Runbook

## 1. Overview
This runbook provides end-to-end instructions for deploying, auditing, verifying, and rolling back Agent Skills in the InterShader ecosystem.

## 2. Release Candidate Prerequisites
Before promoting any skill or registry update:
1. Ensure working directory is clean:
   ```bash
   git status
   ```
2. Verify lockfile integrity against all discovered skills:
   ```bash
   npx tsx cli/index.ts skill verify
   ```
3. Run the static security audit (Snyk Agent Scan model):
   ```bash
   npx tsx cli/index.ts skill audit
   ```
4. Verify TypeScript compilation:
   ```bash
   npm run typecheck
   ```
5. Run automated test suite:
   ```bash
   npx tsx tests/test-skill-aggregation-and-security.ts
   ```

## 3. Step-by-Step Deployment Procedure

### Step 1: Catalog Discovery & Registration
1. Place standard `SKILL.md` in `skills/<skill-name>/` (for Built-in core) or `.intershader/skills/<skill-name>/` (for Workspace extensions).
2. Validate YAML frontmatter schema:
   - `name`: Kebab-case.
   - `version`: Valid SemVer.
   - `upstreamUrl` and `commitSha`: Pinned provenance.
   - `license`: SPDX identifier.
   - `capabilities`: Explicit boundary declarations (`scriptExecution`, `networkAccess`, `filesystemWrite`).

### Step 2: Lockfile Generation & Content Attestation
1. Generate / update `skills.lock.json`:
   ```bash
   npx tsx scripts/generate-skill-lockfile.ts
   ```
2. Inspect the computed SHA-256 digests in `skills.lock.json`.
3. Commit `skills.lock.json` and `skills.allowlist.json` to version control.

### Step 3: Production Build
1. Build the production package:
   ```bash
   npm run build
   ```
2. Verify that `dist/index.js` compiles cleanly without warnings.

### Step 4: Smoke Test & Activation Check
1. Verify discovery:
   ```bash
   npx tsx cli/index.ts skill list
   ```
2. Perform dry-run activation:
   ```bash
   npx tsx cli/index.ts skill activate <skill-name>
   ```
3. Confirm that instructions are injected and security audit passes with 0 critical/high findings.

## 4. Rollback Invariants & Procedure

If a deployed skill produces regressions, unauthorized behaviors, or security alerts:

### Level 1: Immediate Skill Revocation (Zero Downtime)
1. Edit `skills.allowlist.json` and set `"enabled": false` for the targeted skill:
   ```json
   "allowedSkills": {
     "<skill-name>": {
       "enabled": false
     }
   }
   ```
2. Skill activation is instantly blocked for all subsequent agent requests.

### Level 2: Cryptographic Rollback (Revert to Known Good Commit)
1. Restore previous `skills.lock.json` and `skills.allowlist.json` from git:
   ```bash
   git checkout HEAD~1 -- skills.lock.json skills.allowlist.json
   ```
2. Verify integrity:
   ```bash
   npx tsx cli/index.ts skill verify
   ```

### Level 3: Hard Quarantine
1. Move the affected skill directory out of `skills/` or delete from `.intershader/skills/`.
2. Purge runtime skill cache and rebuild if necessary.
