---
name: pytorch-deep-learning-architect
description: Design, scaffold, train, debug, and optimize state-of-the-art Deep Learning models in PyTorch, PyTorch Lightning, and Hugging Face Transformers.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/pytorch-deep-learning-architect
commitSha: a1b2c3d4e5f67890123456789abcdef012345678
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: true
  networkAccess: true
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search, run_shell_command, pytorch_model_builder, huggingface_hub, literature_search]
tags: [pytorch, deep-learning, transformers, neural-networks, amp, cuda, training, optimization]
---

# PyTorch Deep Learning Architect Skill

## Overview
This skill guides the Agent in engineering production-grade, state-of-the-art deep learning architectures using PyTorch 2.x, Hugging Face Transformers/Diffusers, and PyTorch Lightning. It establishes rigorous empirical verification standards for gradient flow, numeric stability, mixed precision, and self-healing error recovery.

## Procedural Workflow

### Step 1: Task Framing & Metric Formalization
1. Identify the task paradigm:
   - **Tabular**: Multi-layer Perceptron (MLP), TabNet, ResNet-Tabular. Metric: AUROC, F1-macro, RMSE.
   - **Vision**: ConvNeXt, Vision Transformers (ViT), Swin. Metric: Top-1 Accuracy, mAP.
   - **NLP & LLM**: Decoder-only Transformers, LoRA/QLoRA PEFT adaptation. Metric: Perplexity, CrossEntropy, ROUGE.
   - **Bio-AI**: Sequence-to-structure (AlphaFold), Variant effect (AlphaGenome), Protein Language Models (ESM-2). Metric: Pearson/Spearman correlation, AUROC, lDDT.

### Step 2: Architecture Scaffolding Standard
1. **Layer Hierarchy**:
   - Always modularize architectures into `Backbone`, `Neck`/`Pooling`, and `Head`.
   - Prefer modern normalization: `RMSNorm` or `LayerNorm` with epsilon `1e-5`.
   - Prefer activation functions with non-zero smooth derivatives: `GeLU` or `SwiGLU`.
2. **Weight Initialization**:
   - Initialize linear layers with Kaiming Normal (for ReLU/GELU) or Xavier Uniform (for self-attention projections).
   - Zero-initialize final projection layers in residual branches to stabilize initial forward passes.

### Step 3: Empirical Sanity Gate (Micro-Batch Overfitting)
1. **MANDATORY AXIOM**: Before launching full dataset training, verify that the architecture can overfit a single mini-batch (8 to 16 samples) to near-zero loss within 30 to 50 iterations.
2. If loss does not drop by at least 70%, halt immediately and inspect:
   - Output logit shapes vs target shapes (e.g. `[B, 1]` vs `[B]`).
   - Softmax applied twice (CrossEntropyLoss in PyTorch expects raw unscaled logits).
   - Detached tensors breaking autograd computational graph.

### Step 4: High-Performance Training Loop
1. **Mixed Precision (AMP)**:
   - Always leverage `torch.amp.autocast('cuda')` with `torch.amp.GradScaler('cuda')` on GPU.
   - Compute loss in FP32 to prevent underflow in cross-entropy exponentiation.
2. **Optimizer & Learning Rate Schedule**:
   - Use `AdamW` with decoupled weight decay (`1e-2`).
   - Apply `CosineAnnealingLR` with linear warmup (typically 5-10% of total training steps).
   - Apply gradient norm clipping (`torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)`).

### Step 5: Self-Healing Diagnostics
1. **CUDA OOM Handling**:
   - Catch `torch.cuda.OutOfMemoryError`.
   - Automatically halve `batch_size`, double `gradient_accumulation_steps`, call `torch.cuda.empty_cache()`, and resume from the latest checkpoint.
2. **Shape Mismatch Resolution**:
   - Match dimension tracebacks. Insert `nn.AdaptiveAvgPool` or update projection linear layers dynamically.
