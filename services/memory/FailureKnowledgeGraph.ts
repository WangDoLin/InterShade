import { FtsMemoryService } from './FtsMemoryService.js';

export interface FailureEnvironment {
  readonly os?: string;
  readonly runtime?: string;
  readonly buildTool?: string;
  readonly version?: string;
}

export interface FailureIncident {
  readonly failureType: string;
  readonly errorMessage: string;
  readonly stackTraceSnippet?: string;
  readonly failingFile?: string;
  readonly rootCause: string;
  readonly effectiveResolution: string;
  readonly stackEnvironment?: string;
  readonly environment?: FailureEnvironment;
  readonly dependencyFingerprint?: string;
  readonly verificationEvidenceHash?: string;
  readonly verifiedProjectsCount?: number;
  readonly successRate?: number; // 0 - 100%
  readonly confidenceScore?: number; // 0.0 - 1.0
}

export interface MatchedFailure {
  readonly failureType: string;
  readonly rootCause: string;
  readonly effectiveResolution: string;
  readonly environmentSummary: string;
  readonly verifiedProjectsCount: number;
  readonly successRate: number;
  readonly confidenceScore: number;
  readonly rank: number;
}

export class FailureKnowledgeGraph {
  /**
   * Persist a rich software engineering failure incident into the durable knowledge graph
   */
  static recordFailure(incident: FailureIncident, projectId = 'default-project'): void {
    const title = `Failure: ${incident.failureType} - ${incident.errorMessage.slice(0, 80)}`;
    const envSummary = incident.environment
      ? `${incident.environment.runtime || 'node'} ${incident.environment.version || ''} (${incident.environment.os || process.platform})`
      : incident.stackEnvironment || process.platform;

    const verifiedProjects = incident.verifiedProjectsCount || 1;
    const successRate = incident.successRate !== undefined ? incident.successRate : 100;
    const confidence = incident.confidenceScore !== undefined ? incident.confidenceScore : 0.95;

    const content = [
      `Error: ${incident.errorMessage}`,
      `Failing File: ${incident.failingFile || 'unknown'}`,
      `Environment: ${envSummary}`,
      `Dependencies: ${incident.dependencyFingerprint || 'standard'}`,
      `Root Cause: ${incident.rootCause}`,
      `Resolution: ${incident.effectiveResolution}`,
      `Verified Projects: ${verifiedProjects}`,
      `Success Rate: ${successRate}%`,
      `Confidence: ${confidence}`,
      `Stack Snippet: ${incident.stackTraceSnippet || 'N/A'}`,
    ].join('\n');

    FtsMemoryService.recordMemory({
      projectId,
      type: 'bug_pattern',
      title,
      content,
    });
  }

  /**
   * Query the knowledge graph for matching past failures and known verified resolutions
   */
  static lookupSimilarFailures(queryText: string, limit = 3): MatchedFailure[] {
    const results = FtsMemoryService.searchMemories(queryText, {
      type: 'bug_pattern',
      limit,
    });

    return results.map((r) => {
      const lines = r.content.split('\n');
      let rootCause = 'Unknown';
      let effectiveResolution = 'No documented resolution';
      let environmentSummary = 'Unknown';
      let verifiedProjectsCount = 1;
      let successRate = 100;
      let confidenceScore = 0.95;

      for (const line of lines) {
        if (line.startsWith('Root Cause:')) {
          rootCause = line.replace('Root Cause:', '').trim();
        } else if (line.startsWith('Resolution:')) {
          effectiveResolution = line.replace('Resolution:', '').trim();
        } else if (line.startsWith('Environment:')) {
          environmentSummary = line.replace('Environment:', '').trim();
        } else if (line.startsWith('Verified Projects:')) {
          verifiedProjectsCount = parseInt(line.replace('Verified Projects:', '').trim(), 10) || 1;
        } else if (line.startsWith('Success Rate:')) {
          successRate = parseFloat(line.replace('Success Rate:', '').replace('%', '').trim()) || 100;
        } else if (line.startsWith('Confidence:')) {
          confidenceScore = parseFloat(line.replace('Confidence:', '').trim()) || 0.95;
        }
      }

      return {
        failureType: r.title.replace('Failure:', '').trim(),
        rootCause,
        effectiveResolution,
        environmentSummary,
        verifiedProjectsCount,
        successRate,
        confidenceScore,
        rank: r.rank,
      };
    });
  }

  /**
   * Normalize raw stack trace / error messages by stripping variable line numbers and memory pointers
   */
  static normalizeStackTrace(raw: string): string {
    return raw
      .replace(/:\d+:\d+/g, ':LINE:COL')
      .replace(/0x[0-9a-fA-F]+/g, '0xPTR')
      .replace(/\bat\s+.+\/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)/g, 'at $1')
      .trim();
  }

  /**
   * Rapidly query the knowledge base for a verified quick-fix recipe
   */
  static findResolutionForError(errorMessage: string): string | null {
    const normalized = this.normalizeStackTrace(errorMessage);
    const matches = this.lookupSimilarFailures(normalized, 1);
    return matches.length > 0 && matches[0].effectiveResolution !== 'No documented resolution'
      ? matches[0].effectiveResolution
      : null;
  }
}
