---
name: cloud-provider-adapter
description: Route model requests across Anthropic, OpenAI, and Gemini with SSRF socket pinning, exponential backoff, and capability-aware fallback.
license: Apache-2.0
version: 1.0.0
author: InterShader Cloud Team
upstreamUrl: https://github.com/openai/plugins/tree/main/skills/cloud-adapter
commitSha: e5f67890123456789abcdef0123456789a1b2c3d4
compatibility:
  node: >=18.0.0
  intershade: >=2.1.0
capabilities:
  scriptExecution: false
  networkAccess: true
  filesystemWrite: false
allowedTools: [model_gateway, provider_probe, network_guard]
tags: [cloud, provider, anthropic, openai, gemini, ssrf-guard, fallback]
---

# Cloud Provider Adapter Skill

## Overview
This skill governs multi-cloud model gateway operations, establishing resilient routing across Anthropic, OpenAI, and Gemini with strict network boundary defense, socket-level IP pinning, and tri-state capability negotiation.

## Procedural Workflow

### Step 1: Upstream Endpoint & SSRF Verification
1. Intercept all outbound model API calls before socket initialization.
2. Verify target domain and IP resolution via `SSRFNetworkGuard`:
   - Block loopback ranges (127.0.0.0/8, ::1).
   - Block RFC 1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
   - Block cloud metadata endpoints (169.254.169.254, metadata.google.internal).
3. Bind verified IP address directly at socket layer to prevent DNS rebinding attacks.

### Step 2: Capability-Aware Routing & Tri-State Negotiation
1. Query `ModelCatalogStore` for model capability profile:
   - Status: `supported`, `unsupported`, or `unknown`.
2. Do not select a model for tool calling if capability status is `unsupported`.
3. If capability is `unknown`, execute a dry-run capability probe before delegating complex multi-tool tasks.

### Step 3: Resilient Fallback & Exponential Backoff
1. On HTTP 429 (Rate Limit) or 503 (Overloaded):
   - Calculate jittered exponential backoff: `min(maxDelay, baseDelay * 2^attempt + jitter)`.
   - Retry up to 3 attempts.
2. If primary provider exhausts retries, trigger safe fallback to secondary configured provider while preserving message history and tool schemas.
