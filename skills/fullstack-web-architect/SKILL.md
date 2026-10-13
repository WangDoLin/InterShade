---
name: fullstack-web-architect
description: Architect, design, build, and optimize fullstack web applications using React, Next.js, Vite, Tailwind CSS, TypeScript, and state management.
license: Apache-2.0
version: 1.0.0
author: InterShader Engineering Team
upstreamUrl: https://github.com/agentskills/agentskills/tree/main/skills/fullstack-web-architect
commitSha: b1c2d3e4f5a6b7c8d9e0123456789abcdef01234
compatibility:
  node: ">=18.0.0"
  intershade: ">=2.1.0"
capabilities:
  scriptExecution: false
  networkAccess: false
  filesystemWrite: true
allowedTools: [file_read, file_edit, file_write, grep_search, glob_find, run_shell_command]
tags: [react, nextjs, vite, tailwind, web, frontend, fullstack, typescript, ui]
---

# Fullstack Web Architect Skill

## Overview
This skill guides InterShade through architecting, developing, and hardening modern web applications. It enforces production-grade component modularity, predictable state flow, robust error boundaries, responsive UX, and optimized Core Web Vitals.

## Procedural Workflow

### Step 1: Architectural Foundation & Routing Strategy
1. **Identify Framework & Bundler Pattern**:
   - Next.js (App Router vs Pages Router): Favor App Router for React Server Components (RSC) and granular streaming boundaries.
   - Vite + React: Favor Vite for fast SPA development with modular client-side routing.
2. **Directory & Module Architecture**:
   - Group by feature domain (e.g. `features/auth/`, `features/billing/`) or clean layered architecture (`components/`, `hooks/`, `services/`, `types/`).
   - Co-locate tests, styles, and sub-components with their parent feature modules.
3. **Data Boundary Segregation**:
   - Segregate Server Components (fetching, direct DB calls, secrets) from Client Components (`'use client'` for interactive UI, state, event handlers).

### Step 2: Component Design & State Management
1. **Component Design Principles**:
   - Single Responsibility Principle (SRP): Decompose complex views into atomic, reusable presentation components.
   - Controlled vs Uncontrolled components: Use React Hook Form or Zod schema validation for robust form handling.
2. **State Management Hierarchy**:
   - Local state: `useState`, `useReducer` for component-isolated states.
   - Global client state: Use lightweight stores (Zustand) over heavy legacy reducers.
   - Server cache state: Use TanStack Query (React Query) or SWR for caching, deduping, and background revalidation.
3. **Styling & Design System**:
   - Utilize Tailwind CSS utility classes with consistent design tokens (typography, color palette, spacing).
   - Ensure responsive design via mobile-first breakpoints (`sm:`, `md:`, `lg:`, `xl:`).

### Step 3: Performance & Core Web Vitals Optimization
1. **Rendering Performance**:
   - Implement dynamic imports (`React.lazy` / `next/dynamic`) for code-splitting heavy third-party bundles (charts, rich editors).
   - Memoize expensive calculations with `useMemo` and callbacks with `useCallback` where profiling demonstrates render bottlenecks.
2. **Asset Optimization**:
   - Optimize images using responsive formats (WebP, AVIF), explicit dimension attributes to prevent Cumulative Layout Shift (CLS).
   - Preload critical fonts and avoid Flash of Unstyled Text (FOUT).

### Step 4: Verification & Accessibility Checklist
1. **Accessibility (a11y)**:
   - Provide valid `aria-label`, semantic HTML elements (`<main>`, `<nav>`, `<section>`, `<article>`), and keyboard navigability.
2. **Automated Verification**:
   - Run typechecking: `tsc --noEmit` or `npm run typecheck`.
   - Run component unit/integration tests with Vitest or Jest.
