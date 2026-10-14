import path from 'node:path';
import type { FileLease, SwarmRole } from './SwarmTypes.js';
import type { ClaudeAgentRoleType } from '../../services/agent/ClaudeAgentRoles.js';

export class FileLockRegistry {
  private static leases: Map<string, FileLease> = new Map();
  private static sessionScopes: Map<string, string[]> = new Map();

  /**
   * Register allowed file scopes (glob patterns) for a given session
   */
  static setSessionScope(sessionId: string, scopes: string[]): void {
    this.sessionScopes.set(sessionId, scopes.map((s) => s.trim()));
  }

  /**
   * Clear session scope registration
   */
  static clearSessionScope(sessionId: string): void {
    this.sessionScopes.delete(sessionId);
  }

  /**
   * Check if a file path is permitted within the session's assigned scopes
   */
  static isFileInScope(filePath: string, scopes?: string[]): boolean {
    if (!scopes || scopes.length === 0 || scopes.includes('*')) {
      return true;
    }

    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

    return scopes.some((pattern) => {
      const normalizedPattern = pattern.replace(/\\/g, '/').toLowerCase();

      if (normalizedPattern === '*' || normalizedPattern === '**') {
        return true;
      }

      // Exact prefix or directory match: "src/services/**" or "src/services/"
      if (normalizedPattern.endsWith('/**')) {
        const prefix = normalizedPattern.slice(0, -3);
        return normalizedPath.startsWith(prefix) || normalizedPath.includes('/' + prefix);
      }
      if (normalizedPattern.endsWith('/*')) {
        const prefix = normalizedPattern.slice(0, -2);
        return normalizedPath.startsWith(prefix);
      }

      // Extension wildcard: "*.ts" or "**/*.tsx"
      if (normalizedPattern.startsWith('*.')) {
        const ext = normalizedPattern.slice(1);
        return normalizedPath.endsWith(ext);
      }

      // Substring match
      return normalizedPath.includes(normalizedPattern);
    });
  }

  /**
   * Acquire an exclusive write lease on a target file
   */
  static acquireLease(
    filePath: string,
    sessionId: string,
    role: SwarmRole | ClaudeAgentRoleType,
    ttlMs: number = 60000
  ): { acquired: boolean; owner?: string; reason?: string } {
    const normalized = path.resolve(filePath).toLowerCase();
    const now = Date.now();

    // Check scope permission if session has registered scopes
    const scopes = this.sessionScopes.get(sessionId);
    if (scopes && scopes.length > 0 && !this.isFileInScope(filePath, scopes)) {
      return {
        acquired: false,
        reason: `[SCOPE VIOLATION]: File "${filePath}" is outside the assigned scope for role "${role}" ([${scopes.join(', ')}]).`,
      };
    }

    // Clean up expired lease if exists
    const existing = this.leases.get(normalized);
    if (existing && existing.expiresAt <= now) {
      this.leases.delete(normalized);
    }

    const active = this.leases.get(normalized);
    if (active) {
      if (active.sessionId === sessionId) {
        // Renew lease for the same session
        active.expiresAt = now + ttlMs;
        return { acquired: true };
      }

      const timeLeftSec = Math.max(1, Math.ceil((active.expiresAt - now) / 1000));
      return {
        acquired: false,
        owner: `${active.role} (Session ${active.sessionId})`,
        reason: `[FILE LEASE CONFLICT]: File "${filePath}" is currently exclusively locked by ${active.role} (Session "${active.sessionId}"). Lease expires in ${timeLeftSec}s.`,
      };
    }

    // Grant new lease
    this.leases.set(normalized, {
      filePath,
      sessionId,
      role,
      grantedAt: now,
      expiresAt: now + ttlMs,
    });

    return { acquired: true };
  }

  /**
   * Release lease on a specific file held by a session
   */
  static releaseLease(filePath: string, sessionId: string): void {
    const normalized = path.resolve(filePath).toLowerCase();
    const active = this.leases.get(normalized);
    if (active && active.sessionId === sessionId) {
      this.leases.delete(normalized);
    }
  }

  /**
   * Release all leases currently held by a given session
   */
  static releaseAllLeasesForSession(sessionId: string): number {
    let releasedCount = 0;
    for (const [key, lease] of this.leases.entries()) {
      if (lease.sessionId === sessionId) {
        this.leases.delete(key);
        releasedCount++;
      }
    }
    this.sessionScopes.delete(sessionId);
    return releasedCount;
  }

  /**
   * Query the current lease holder of a file
   */
  static getLease(filePath: string): FileLease | undefined {
    const normalized = path.resolve(filePath).toLowerCase();
    const lease = this.leases.get(normalized);
    if (lease && lease.expiresAt > Date.now()) {
      return lease;
    }
    if (lease && lease.expiresAt <= Date.now()) {
      this.leases.delete(normalized);
    }
    return undefined;
  }

  /**
   * List all currently active leases
   */
  static listActiveLeases(): FileLease[] {
    const now = Date.now();
    const active: FileLease[] = [];
    for (const [key, lease] of this.leases.entries()) {
      if (lease.expiresAt > now) {
        active.push(lease);
      } else {
        this.leases.delete(key);
      }
    }
    return active;
  }

  /**
   * Clear all leases (for test fixtures / teardown)
   */
  static clearAll(): void {
    this.leases.clear();
    this.sessionScopes.clear();
  }
}
