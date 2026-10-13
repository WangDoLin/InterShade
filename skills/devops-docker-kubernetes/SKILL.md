---
name: devops-docker-kubernetes
description: Package, containerize, and deploy resilient cloud services using multi-stage Dockerfiles, Docker Compose, and production Kubernetes manifests.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/devops-docker-kubernetes
commitSha: e4f5a6b7c8d9e0123456789abcdef012345a6b7c
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, run_shell_command]
tags: [devops, docker, kubernetes, containers, deployment, k8s, dockerfile, cloud]
---

# DevOps Docker & Kubernetes Skill

## Overview
This skill provides automated procedural guidelines for containerizing software components with minimal attack surface, optimal layer caching, and production-grade Kubernetes orchestration manifests.

## Procedural Workflow

### Step 1: Production-Grade Multi-Stage Dockerfile Design
1. **Multi-Stage Architecture**:
   - `builder` stage: Install build dependencies, compilers, dev tools, and generate application artifacts.
   - `runtime` stage: Use minimal distroless or Alpine base images containing only production runtime binaries.
2. **Layer Caching Optimization**:
   - Copy dependency manifests (`package.json`, `package-lock.json`, `pyproject.toml`, `go.mod`) BEFORE copying source code to maximize Docker cache reuse.
   - Combine consecutive `RUN` statements with `&&` to minimize intermediate image layers.
3. **Security Hardening**:
   - Always run as an unprivileged, non-root user (`USER node` or `USER 10001:10001`).
   - Clean up package manager caches using non-caching flags (e.g. apk --no-cache or apt-get clean) in the same layer.
   - Ensure a `.dockerignore` file exists to exclude `.git`, `node_modules`, `.env`, and local caches.

### Step 2: Docker Compose Orchestration
1. **Service Definition & Networking**:
   - Define dedicated bridge networks for service isolation.
   - Configure health checks with appropriate `interval`, `timeout`, and `retries`.
2. **Persistence & Secrets**:
   - Mount named volumes for database storage to prevent accidental data loss.
   - Use environment variable interpolation via `.env` files rather than hardcoded credentials.

### Step 3: Production Kubernetes (K8s) Manifest Architecture
1. **Workload Resource Management**:
   - Always specify explicit `requests` and `limits` for both CPU and memory to prevent OOMKilled cascade failures.
   - Implement Horizontal Pod Autoscaling (HPA) targets based on CPU/memory utilization or custom metrics.
2. **Probes & Resilience**:
   - Configure `livenessProbe` to detect hung or deadlocked processes.
   - Configure `readinessProbe` to remove pods from the Service endpoints before they finish warmup or initialization.
   - Set up `terminationGracePeriodSeconds` to allow graceful shutdown of in-flight requests.
3. **Configuration & Secrets**:
   - Externalize configuration with `ConfigMap` and sensitive values with `Secret`.
   - Never embed base64 plaintext secrets in repository version control.
