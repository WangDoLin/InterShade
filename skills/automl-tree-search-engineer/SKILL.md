---
name: automl-tree-search-engineer
description: Conduct autonomous exploratory tree search over machine learning code, architectures, and hyperparameters inspired by AIDE and The AI Scientist.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/automl-tree-search-engineer
commitSha: b2c3d4e5f67890123456789abcdef0123456789a
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: true
  networkAccess: true
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search, run_shell_command, pytorch_model_builder, literature_search]
tags: [automl, tree-search, aide, ai-scientist, hyperparameter-optimization, experimentation, ablation]
---

# AutoML Tree Search Engineer Skill

## Overview
This skill operationalizes the autonomous Machine Learning Engineering tree-search paradigm established by Weco AI (AIDE) and Sakana AI (The AI Scientist). Rather than treating model generation as a linear one-shot script, the Agent maintains a directed acyclic exploration graph of code variants, empirical metrics, and validation scores.

## Procedural Workflow

### Step 1: Solution Tree Initialization
1. Establish a root baseline node:
   - Construct minimal valid pipeline: Data ingestion, simple model (e.g. Logistic Regression / Basic MLP / Linear probe), deterministic evaluation metric.
   - Record baseline validation score: $M_{0}$.

### Step 2: Iterative Candidate Generation (Branching)
1. For each exploration cycle:
   - Formulate a testable hypothesis (e.g., "Replacing LayerNorm with RMSNorm and adding SwiGLU activation improves feature representation").
   - Generate child code variant from the current best candidate node.
   - Restrict modifications to targeted, atomic changes (diff budget <= 50 lines).

### Step 3: Empirical Execution & Metric Extraction
1. Execute the candidate training script in the `uv` sandbox.
2. Extract the target validation metric from stdout telemetry.
3. Compare candidate metric $M_{cand}$ against parent metric $M_{parent}$:
   - **Improvement ($M_{cand} > M_{best}$)**: Mark node as `ACCEPTED`. Set new baseline. Spawn subsequent experiments from this node.
   - **Degradation or Error ($M_{cand} \le M_{best}$)**: Mark node as `PRUNED`. Backtrack to the best known node.

### Step 4: Ablation & Verification Gate
1. Perform ablation studies on the top candidate:
   - Remove individual feature groups or architectural components to verify their empirical contribution.
   - Confirm that improvements are statistically significant and not artifacts of random seed variance.
