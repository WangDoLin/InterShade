---
name: database-sql-optimizer
description: Design, optimize, profile, and migrate relational databases and SQL queries across PostgreSQL, SQLite, and MySQL.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/database-sql-optimizer
commitSha: c2d3e4f5a6b7c8d9e0123456789abcdef012345a
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, grep_search, run_shell_command]
tags: [sql, database, postgresql, sqlite, mysql, indexing, migrations, query-optimization, orm]
---

# Database & SQL Optimizer Skill

## Overview
This skill provides automated procedural guidelines for analyzing database schemas, eliminating query performance bottlenecks, designing optimal indexes, and guaranteeing zero-downtime data migrations.

## Procedural Workflow

### Step 1: Query Execution Plan & Profiling
1. **Explain Plan Inspection**:
   - PostgreSQL: Use `EXPLAIN (ANALYZE, BUFFERS, VERBOSE) <query>`.
   - SQLite: Use `EXPLAIN QUERY PLAN <query>`.
   - MySQL: Use `EXPLAIN FORMAT=JSON <query>`.
2. **Identify Costly Access Methods**:
   - Detect Sequential Scans (`Seq Scan`) on large tables ($>10,000$ rows) where an Index Scan should be utilized.
   - Detect Nested Loop joins with high inner loop iterations causing quadratic execution times.
   - Detect temporary disk sorts (`Sort Method: external merge Disk`) indicating insufficient `work_mem` or missing composite indexes.

### Step 2: Strategic Indexing & Schema Design
1. **Index Selection**:
   - B-Tree: Default choice for equality (`=`) and range queries (`<`, `<=`, `>`, `>=`, `BETWEEN`).
   - Composite Indexes: Order columns according to the Equality-Range-Sort (ESR) rule: Equality predicates first, Sort columns second, Range predicates last.
   - Partial Indexes: Index only active rows (e.g., `WHERE status = 'active'`) to reduce index tree size and write overhead.
2. **Preventing Index Invalidation Anti-Patterns**:
   - Avoid applying functions or calculations to indexed columns in WHERE clauses (e.g., `WHERE LOWER(email) = ?` requires functional index `CREATE INDEX ON users (LOWER(email))`).
   - Avoid leading wildcards in LIKE predicates (`LIKE '%search'` cannot leverage B-Tree index; consider Trigram / GIN index).

### Step 3: Transaction Isolation & Concurrency Tuning
1. **Transaction Isolation Levels**:
   - Use `Read Committed` for general workloads to balance concurrency and consistency.
   - Use `Repeatable Read` or `Serializable` only when preventing non-repeatable reads or phantom rows is strictly required.
2. **Deadlock & Contention Prevention**:
   - Always acquire table/row locks in a consistent, deterministic order across all concurrent transactions.
   - Keep transactions as short and focused as possible: perform heavy computation or external I/O outside the transaction boundary.
3. **SQLite Specific Tuning**:
   - Enable Write-Ahead Logging: `PRAGMA journal_mode = WAL;`.
   - Configure busy timeout: `PRAGMA busy_timeout = 5000;`.
   - Enable foreign keys: `PRAGMA foreign_keys = ON;`.

### Step 4: Migration Safety & Zero-Downtime Operations
1. **Safe DDL Migrations**:
   - Never add a column with a non-constant `DEFAULT` on large tables without careful review.
   - Create indexes concurrently in PostgreSQL: `CREATE INDEX CONCURRENTLY`.
2. **N+1 Query Elimination**:
   - Inspect ORM query patterns (Prisma, TypeORM, Drizzle, SQLAlchemy) and verify that relationships are eagerly loaded via `JOIN` or batch queries (`dataloader` pattern).
