---
name: database-zero-downtime-migration
description: Design and verify zero-downtime database schema migrations, lock avoidance, and backward-compatible data evolution for PostgreSQL and SQLite.
license: Apache-2.0
version: 1.0.0
author: InterShader Team
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search]
tags: [database, sql, migration, zero-downtime, postgres, sqlite]
---

# Database Zero-Downtime Migration Skill

## Overview
This skill guides the design, review, and verification of zero-downtime database schema migrations. It prevents table locks, connection pool exhaustion, and breaking schema changes while services are actively serving traffic.

## Golden Rules for Zero-Downtime Migrations

### 1. Expand / Contract Pattern
Never rename or drop columns in a single step:
- **Phase 1 (Expand)**: Add new column as nullable or with default value.
- **Phase 2 (Dual-Write)**: Application writes to both old and new columns, reads from old.
- **Phase 3 (Backfill)**: Backfill historical data in small batched transactions.
- **Phase 4 (Switch)**: Application reads from new column.
- **Phase 5 (Contract)**: Drop old column in a subsequent release.

### 2. Lock Avoidance in PostgreSQL
- **Adding Indexes**: Always use `CREATE INDEX CONCURRENTLY` to avoid locking writes.
- **Adding Columns**:
  - In Postgres 11+, `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` is instantaneous for constant defaults.
  - Adding `NOT NULL` without default requires a table scan. Add column as nullable first, add check constraint `NOT VALID`, then validate asynchronously.
- **Lock Timeouts**: Always set `SET lock_timeout = '2s';` before running DDL migrations so the query fails fast rather than queueing up and blocking transactions.

### 3. SQLite Concurrent Migration Rules
- Use `PRAGMA journal_mode = WAL;` to enable concurrent readers alongside a single writer.
- Wrap schema updates in explicit `BEGIN IMMEDIATE;` transactions to prevent deadlock when multiple connections attempt writes.
- Always perform a backup of the `.db` file before running destructive migration scripts.
