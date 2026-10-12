import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import ignore from 'ignore';
import fg from 'fast-glob';
import { TokenCounter } from './TokenCounter.js';
import { AstSkeletonExtractor } from './AstSkeletonExtractor.js';

export interface SmartRepomixOptions {
  baseDir?: string;
  focusPaths?: string[];
  maxTokens?: number;
  includeTree?: boolean;
  includeGitDiff?: boolean;
  includeAstOnly?: boolean;
  customIgnore?: string[];
}

export interface TierStat {
  name: string;
  filesCount: number;
  tokens: number;
}

export interface RepomixResult {
  root: string;
  totalFilesFound: number;
  packedFilesCount: number;
  estimatedTokens: number;
  xml: string;
  tierBreakdown: TierStat[];
  truncatedDueToBudget: boolean;
}

const DEFAULT_IGNORED_PATTERNS = [
  'node_modules/**',
  '.git/**',
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  'coverage/**',
  '.cache/**',
  '.turbo/**',
  'target/**',
  'vendor/**',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  '.env*',
  '*.pem',
  '*.key',
  '*.pfx',
  'id_rsa*',
  '*.log',
  '*.sqlite*',
  '*.db',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.svg',
  '*.ico',
  '*.wasm',
  '*.exe',
  '*.dll',
  '*.so',
  '*.dylib',
  '*.pdf',
  '*.zip',
  '*.tar.gz',
  '*.tgz'
];

const MANIFEST_NAMES = [
  'package.json',
  'tsconfig.json',
  'Cargo.toml',
  'pyproject.toml',
  'setup.py',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'CMakeLists.txt',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'README.md',
  'ARCHITECTURE.md',
  'AGENTS.md'
];

export class SmartRepomix {
  /**
   * Packs repository context into an optimized, token-bounded XML prompt snapshot.
   */
  static async pack(options: SmartRepomixOptions = {}): Promise<RepomixResult> {
    const root = path.resolve(options.baseDir || process.cwd());
    const maxTokens = options.maxTokens || 16000;
    const includeTree = options.includeTree !== false;
    const includeGitDiff = options.includeGitDiff !== false;
    const includeAstOnly = options.includeAstOnly === true;

    const ig = ignore().add(DEFAULT_IGNORED_PATTERNS);
    if (options.customIgnore) {
      ig.add(options.customIgnore);
    }

    // Check project .gitignore if exists
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        ig.add(gitignoreContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
      } catch {
        // Ignore gitignore read errors
      }
    }

    // Discover all candidate files
    const allFileEntries = await fg(['**/*'], {
      cwd: root,
      dot: true,
      onlyFiles: true,
      ignore: ['node_modules/**', '.git/**']
    });

    const filteredFiles = allFileEntries.filter(f => !ig.ignores(f));
    const totalFilesFound = filteredFiles.length;

    let currentTokens = 0;
    let packedFilesCount = 0;
    let truncatedDueToBudget = false;

    const tierBreakdown: TierStat[] = [
      { name: 'Tier 1 (Manifests & Docs)', filesCount: 0, tokens: 0 },
      { name: 'Tier 2 (Focus / Git-Dirty)', filesCount: 0, tokens: 0 },
      { name: 'Tier 3 (AST Skeletons)', filesCount: 0, tokens: 0 },
      { name: 'Tier 4 (File Tree & Git)', filesCount: 0, tokens: 0 }
    ];

    const xmlParts: string[] = [];
    xmlParts.push(`<repository root="${root}" generated_at="${new Date().toISOString()}">`);

    // --- Git Context ---
    let gitSection = '';
    if (includeGitDiff) {
      try {
        const gitStatus = execSync('git status --short', { cwd: root, encoding: 'utf8', timeout: 2000 }).trim();
        const gitDiffStat = execSync('git diff --stat HEAD', { cwd: root, encoding: 'utf8', timeout: 2000 }).trim();
        if (gitStatus || gitDiffStat) {
          gitSection = `  <git_context>\n    <status>\n${gitStatus || 'clean'}\n    </status>\n    <diff_stat>\n${gitDiffStat || 'no changes'}\n    </diff_stat>\n  </git_context>`;
          const gitTokens = TokenCounter.estimateStringTokens(gitSection);
          currentTokens += gitTokens;
          tierBreakdown[3].tokens += gitTokens;
        }
      } catch {
        // Not a git repository or git error
      }
    }

    // --- Tier 1: Manifests & Docs ---
    const manifestFiles = filteredFiles.filter(f => {
      const base = path.basename(f);
      return MANIFEST_NAMES.includes(base);
    });

    const manifestXmlNodes: string[] = [];
    for (const relPath of manifestFiles) {
      if (currentTokens >= maxTokens * 0.95) {
        truncatedDueToBudget = true;
        break;
      }
      try {
        const fullPath = path.join(root, relPath);
        let content = fs.readFileSync(fullPath, 'utf8');
        // If README is massive, take first 100 lines
        if (relPath.toLowerCase() === 'readme.md') {
          const lines = content.split('\n');
          if (lines.length > 100) {
            content = lines.slice(0, 100).join('\n') + '\n\n<!-- [README truncated for repository packing] -->';
          }
        }
        const fileXml = `    <file path="${relPath}">\n${content}\n    </file>`;
        const tokens = TokenCounter.estimateStringTokens(fileXml);
        if (currentTokens + tokens > maxTokens) {
          truncatedDueToBudget = true;
          break;
        }
        manifestXmlNodes.push(fileXml);
        currentTokens += tokens;
        packedFilesCount++;
        tierBreakdown[0].filesCount++;
        tierBreakdown[0].tokens += tokens;
      } catch {
        // Skip unreadable files
      }
    }

    if (manifestXmlNodes.length > 0) {
      xmlParts.push(`  <manifests>\n${manifestXmlNodes.join('\n')}\n  </manifests>`);
    }

    if (gitSection) {
      xmlParts.push(gitSection);
    }

    // --- Tier 2: Focus Files (Full Content) ---
    const focusSet = new Set<string>();
    if (options.focusPaths && options.focusPaths.length > 0) {
      for (const pattern of options.focusPaths) {
        const matches = filteredFiles.filter(f => f === pattern || f.startsWith(pattern));
        matches.forEach(m => focusSet.add(m));
      }
    }

    const focusXmlNodes: string[] = [];
    if (!includeAstOnly && focusSet.size > 0) {
      for (const relPath of focusSet) {
        if (manifestFiles.includes(relPath)) continue;
        if (currentTokens >= maxTokens * 0.95) {
          truncatedDueToBudget = true;
          break;
        }
        try {
          const fullPath = path.join(root, relPath);
          const content = fs.readFileSync(fullPath, 'utf8');
          const fileXml = `    <file path="${relPath}">\n${content}\n    </file>`;
          const tokens = TokenCounter.estimateStringTokens(fileXml);
          if (currentTokens + tokens > maxTokens) {
            truncatedDueToBudget = true;
            break;
          }
          focusXmlNodes.push(fileXml);
          currentTokens += tokens;
          packedFilesCount++;
          tierBreakdown[1].filesCount++;
          tierBreakdown[1].tokens += tokens;
        } catch {
          // Skip unreadable files
        }
      }
      if (focusXmlNodes.length > 0) {
        xmlParts.push(`  <focus_files>\n${focusXmlNodes.join('\n')}\n  </focus_files>`);
      }
    }

    // --- Tier 3: AST Skeletons of Codebase ---
    const skeletonXmlNodes: string[] = [];
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.cs'];
    const candidateSourceFiles = filteredFiles.filter(f => {
      if (manifestFiles.includes(f) || focusSet.has(f)) return false;
      const ext = path.extname(f).toLowerCase();
      return sourceExtensions.includes(ext);
    });

    for (const relPath of candidateSourceFiles) {
      if (currentTokens >= maxTokens * 0.90) {
        truncatedDueToBudget = true;
        break;
      }
      try {
        const fullPath = path.join(root, relPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        const skeleton = AstSkeletonExtractor.extract(relPath, content);
        const fileXml = `    <file path="${relPath}" lang="${skeleton.language}" saved="${skeleton.compressionRatio}%">\n${skeleton.skeletonContent}\n    </file>`;
        const tokens = TokenCounter.estimateStringTokens(fileXml);
        if (currentTokens + tokens > maxTokens) {
          truncatedDueToBudget = true;
          break;
        }
        skeletonXmlNodes.push(fileXml);
        currentTokens += tokens;
        packedFilesCount++;
        tierBreakdown[2].filesCount++;
        tierBreakdown[2].tokens += tokens;
      } catch {
        // Skip
      }
    }

    if (skeletonXmlNodes.length > 0) {
      xmlParts.push(`  <ast_skeletons>\n${skeletonXmlNodes.join('\n')}\n  </ast_skeletons>`);
    }

    // --- Tier 4: Directory Structure / File Tree ---
    if (includeTree) {
      const treeString = this.buildAsciiTree(filteredFiles);
      const treeXml = `  <file_tree total_files="${totalFilesFound}">\n${treeString}\n  </file_tree>`;
      const treeTokens = TokenCounter.estimateStringTokens(treeXml);
      currentTokens += treeTokens;
      tierBreakdown[3].filesCount = totalFilesFound;
      tierBreakdown[3].tokens += treeTokens;
      xmlParts.push(treeXml);
    }

    xmlParts.push('</repository>');
    const finalXml = xmlParts.join('\n');
    const estimatedTokens = TokenCounter.estimateStringTokens(finalXml);

    return {
      root,
      totalFilesFound,
      packedFilesCount,
      estimatedTokens,
      xml: finalXml,
      tierBreakdown,
      truncatedDueToBudget
    };
  }

  /**
   * Generates a compact ASCII directory tree from a list of relative file paths.
   */
  private static buildAsciiTree(filePaths: string[]): string {
    const tree: Record<string, any> = {};

    for (const file of filePaths) {
      const parts = file.split(/[\\/]/);
      let current = tree;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          current[part] = null;
        } else {
          current[part] = current[part] || {};
          current = current[part];
        }
      }
    }

    const lines: string[] = ['.'];
    function walk(node: Record<string, any>, prefix = '') {
      const keys = Object.keys(node).sort((a, b) => {
        const aIsDir = node[a] !== null;
        const bIsDir = node[b] !== null;
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.localeCompare(b);
      });

      keys.forEach((key, index) => {
        const isLast = index === keys.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = isLast ? '    ' : '│   ';
        const isDir = node[key] !== null;

        lines.push(`${prefix}${connector}${key}${isDir ? '/' : ''}`);
        if (isDir) {
          walk(node[key], prefix + childPrefix);
        }
      });
    }

    walk(tree);
    return lines.join('\n');
  }
}
