import { SmartRepomix } from '../context/SmartRepomix.js';
import { AstSkeletonExtractor } from '../context/AstSkeletonExtractor.js';

async function run() {
  console.log('=== 1. Testing AST Skeleton Extractor ===');
  const sampleTsCode = `
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
}

export type Role = 'admin' | 'member' | 'guest';

export class UserService {
  private db: any;

  constructor(db: any) {
    this.db = db;
    console.log('Initializing UserService with internal details...');
  }

  public async getUser(id: string): Promise<UserProfile | null> {
    const raw = await this.db.query('SELECT * FROM users WHERE id = ?', id);
    if (!raw) return null;
    return {
      id: raw.id,
      username: raw.username,
      email: raw.email
    };
  }
}

export function calculateTotal(items: number[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item;
  }
  return sum;
}
`;

  const skeleton = AstSkeletonExtractor.extract('UserService.ts', sampleTsCode);
  console.log('Language:', skeleton.language);
  console.log('Original Tokens:', skeleton.originalTokens);
  console.log('Skeleton Tokens:', skeleton.skeletonTokens);
  console.log('Compression Ratio:', skeleton.compressionRatio + '%');
  console.log('--- Extracted Skeleton ---');
  console.log(skeleton.skeletonContent);

  console.log('\n=== 2. Testing SmartRepomix on Codebase ===');
  const packResult = await SmartRepomix.pack({
    baseDir: '.',
    maxTokens: 12000,
    includeTree: true,
    includeGitDiff: true
  });

  console.log('Root:', packResult.root);
  console.log('Total files found:', packResult.totalFilesFound);
  console.log('Packed files count:', packResult.packedFilesCount);
  console.log('Estimated tokens:', packResult.estimatedTokens);
  console.log('Truncated due to budget?:', packResult.truncatedDueToBudget);
  console.log('Tier breakdown:');
  for (const tier of packResult.tierBreakdown) {
    console.log(`  ${tier.name}: ${tier.filesCount} files, ~${tier.tokens} tokens`);
  }

  console.log('\n--- First 400 chars of XML Output ---');
  console.log(packResult.xml.slice(0, 400));
  console.log('...\n--- End of Test ---');
}

run().catch(console.error);
