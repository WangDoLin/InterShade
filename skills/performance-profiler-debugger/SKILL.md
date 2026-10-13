---
name: performance-profiler-debugger
description: Profile, diagnose, and remediate performance bottlenecks, memory leaks, event loop latency, and resource bloat across Node.js and web runtimes.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/performance-profiler-debugger
commitSha: f5a6b7c8d9e0123456789abcdef012345a6b7c8d
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, run_shell_command, grep_search]
tags: [performance, memory-leak, profiling, cpu, optimization, cache, latency, debugging]
---

# Performance Profiler & Debugger Skill

## Overview
This skill provides automated procedural guidelines for analyzing performance regressions, diagnosing insidious memory leaks, identifying CPU hotspots, and implementing high-efficiency caching tiers.

## Procedural Workflow

### Step 1: Memory Leak Detection & Heap Analysis
1. **Identify Memory Growth Patterns**:
   - Monitor V8 heap statistics: `process.memoryUsage().heapUsed` vs `heapTotal`.
   - Distinguish transient garbage generation from monotonic upward slopes indicating retained object leaks.
2. **Common Culprits**:
   - Global event listeners (`EventEmitter.on`) without corresponding `removeListener` / `off`.
   - Unbounded in-memory collections (Maps/Arrays used as caches without size limits or eviction policies).
   - Closures capturing large outer scopes unexpectedly.
   - Detached DOM nodes or unclosed database connections.
3. **Remediation**:
   - Replace unbounded `Map` instances with bounded LRU caches (Least Recently Used) with explicit TTLs.
   - Use `WeakMap` or `WeakSet` when associating metadata with object lifecycles to allow automatic garbage collection.

### Step 2: CPU Profiling & Event Loop Lag
1. **Detecting Blocking Code**:
   - Measure event loop lag: Detect synchronous blocks exceeding 20ms that starve asynchronous timers and socket I/O.
   - Avoid synchronous cryptographic or filesystem operations (`fs.readFileSync`, `crypto.pbkdf2Sync`) in high-throughput hot paths.
2. **Algorithmic Complexity Optimization**:
   - Convert $O(N^2)$ nested array searches (`array.filter(a => b.includes(a.id))`) to $O(N)$ hash set lookups (`const idSet = new Set(b); array.filter(a => idSet.has(a.id))`).
   - Use indexed lookups instead of repeated full-collection scans.

### Step 3: Multi-Tier Caching Architecture
1. **Tier Design**:
   - L1 Cache: In-memory local cache (ultrafast, process-local, sub-millisecond retrieval).
   - L2 Cache: Distributed cache (Redis / Memcached for shared cross-instance invalidation).
2. **Invalidation Strategies**:
   - Cache-Aside (Lazy Loading): Read from cache; on miss, read from primary store and write back to cache.
   - Stale-While-Revalidate: Return stale cached data immediately while asynchronously refreshing data in the background.
   - Stampede / Thundering Herd Prevention: Use single-flight mutexes or promise memoization to ensure only one concurrent worker fetches from the database during cache misses.
