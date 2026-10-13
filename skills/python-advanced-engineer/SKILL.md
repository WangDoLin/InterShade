---
name: python-advanced-engineer
description: Architect, test, and maintain modern Python applications using Python 3.10+, FastAPI, AsyncIO, Pytest, Pydantic, and strict type hinting.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/python-advanced-engineer
commitSha: d3e4f5a6b7c8d9e0123456789abcdef012345a6b
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search, run_shell_command]
tags: [python, fastapi, asyncio, pytest, pydantic, type-hints, mypy, backend]
---

# Python Advanced Engineer Skill

## Overview
This skill provides automated procedural guidelines for engineering modern Python 3.10+ systems. It establishes idiomatic architectural patterns for asynchronous concurrency, robust type safety, dependency injection, and comprehensive automated testing.

## Procedural Workflow

### Step 1: Environment & Packaging Standard
1. **Tooling & Dependency Management**:
   - Prefer modern lockfile packaging (`uv`, `poetry`, or `pdm`) over unpinned `requirements.txt`.
   - Maintain strict separation between runtime dependencies and development dependencies.
2. **Configuration Management**:
   - Use `pydantic-settings` to parse and validate environment variables with strict type coercion and default fallbacks.
   - Never hardcode credentials, connection strings, or environment-dependent variables in code.

### Step 2: Strict Typing & Data Modeling
1. **Type Annotations**:
   - Leverage Python 3.10+ native union syntax (`X | Y` instead of `Union[X, Y]`).
   - Use `typing.Annotated` for metadata-driven validation.
   - Run static type checkers (`mypy` or `pyright`) with `--strict` flags enabled.
2. **Data Modeling with Pydantic v2**:
   - Prefer `BaseModel` with frozen/immutable configuration (`model_config = ConfigDict(frozen=True)`) for domain models.
   - Leverage `@field_validator` and `@model_validator` for cross-field consistency validation.

### Step 3: Concurrency & AsyncIO Engineering
1. **Async Event Loop Best Practices**:
   - Never call blocking synchronous I/O functions (`time.sleep`, standard `requests`, synchronous file I/O) inside an `async def` function.
   - Offload CPU-bound or legacy synchronous I/O tasks to a thread pool executor: `asyncio.to_thread(sync_func, *args)`.
2. **Task Lifecycles & Cancellation**:
   - Use `asyncio.TaskGroup` (Python 3.11+) or `asyncio.gather(..., return_exceptions=True)` to handle concurrent execution cleanly.
   - Guarantee cleanup of active tasks and open sockets on shutdown signals (`SIGTERM`, `SIGINT`) via asynchronous context managers (`async with`).

### Step 4: Testing & Quality Assurance
1. **Pytest Architecture**:
   - Structure tests cleanly using scoped fixtures (`scope="function"` for database rollbacks, `scope="session"` for test containers).
   - Use `pytest-asyncio` with `asyncio_mode = "auto"`.
2. **Mocking & Isolation**:
   - Use `unittest.mock.AsyncMock` when stubbing async service boundaries.
   - Enforce minimum 80% coverage on core business logic via `pytest-cov`.
