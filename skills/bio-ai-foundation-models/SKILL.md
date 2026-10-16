---
name: bio-ai-foundation-models
description: Integrate biological foundation models, protein 3D structure predictors (AlphaFold 3), genomic variant effect models (AlphaGenome), and ESM protein language models.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/bio-ai-foundation-models
commitSha: c3d4e5f67890123456789abcdef0123456789a1b
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: true
  networkAccess: true
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search, run_shell_command, alphagenome_analysis, alphafold_structure, human_protein_atlas, encode_ccres, literature_search]
tags: [bio-ai, genomics, alphafold, alphagenome, esm, protein-folding, encode, deep-learning-biology]
---

# Bio-AI Foundation Models Skill

## Overview
This skill guides the Agent in architecting, fine-tuning, and evaluating biological deep learning foundation models. It bridges bioinformatics, sequence modeling, 3D structural biology, and functional genomics into an empirical software engineering workflow.

## Procedural Workflow

### Step 1: Biological Sequence Ingestion & Leakage Prevention
1. **Sequence Identity Clustering**:
   - In biological machine learning (proteins, DNA, RNA), standard random K-fold splits cause severe data leakage due to homologous sequences.
   - Always cluster sequences at <= 30% sequence identity (using MMseqs2 or CD-HIT) before defining train/validation/test partitions.
2. **Vocabulary & Tokenization**:
   - For proteins: 20 canonical amino acids + special tokens (`<cls>`, `<pad>`, `<mask>`).
   - For genomics: k-mer tokenization (e.g. 6-mers) or single-nucleotide resolution with rotary position embeddings (RoPE).

### Step 2: Foundation Model Backbones
1. **Protein Language Models (pLMs)**:
   - Prefer ESM-2 (`facebook/esm2_t33_650M_UR50D`) or ProtBERT for extracting residue-level embeddings and contact maps.
   - For downstream classification/affinity regression, freeze the backbone and train a lightweight attention head or use LoRA PEFT ($r=8, \alpha=16$).
2. **Genomic Variant Effect Modeling**:
   - Leverage `alphagenome_analysis` to predict the impact of non-coding single-nucleotide variants on splicing, chromatin accessibility, and transcription factor binding.
3. **3D Structure Modeling**:
   - Use `alphafold_structure` to fetch or predict coordinates (PDB/CIF) and interpret local confidence scores (pLDDT > 70 for confident prediction).

### Step 3: Evaluation Metrics in Biological AI
1. **Structure Quality**: Predicted Local Distance Difference Test (pLDDT), Template Modeling score (TM-score), RMSD.
2. **Variant Effect & Binding Affinity**: Spearman rank correlation ($\rho$), Pearson correlation ($r$), Area Under ROC Curve (AUROC).
