import { getDatabase } from './Database.js';
import type { UnifiedMessage, SessionState, SessionConfig } from '../types/index.js';
import { randomUUID } from 'crypto';

/**
 * Session persistence and history store backed by SQLite WAL
 */
export class SessionStore {
  static createSession(config: SessionConfig, title = 'New Conversation'): SessionState {
    const db = getDatabase();
    const now = Date.now();
    const session: SessionState = {
      id: config.sessionId || randomUUID(),
      createdAt: now,
      updatedAt: now,
      model: config.model,
      provider: config.provider,
      cwd: config.cwd,
      permissionMode: config.permissionMode || 'default',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0.0,
    };

    const stmt = db.prepare(`
      INSERT INTO sessions (id, title, model, provider, cwd, permission_mode, total_input_tokens, total_output_tokens, total_cost_usd, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      title,
      session.model,
      session.provider,
      session.cwd,
      session.permissionMode,
      session.totalInputTokens,
      session.totalOutputTokens,
      session.totalCostUsd,
      session.createdAt,
      session.updatedAt
    );

    return session;
  }

  static appendMessage(sessionId: string, message: UnifiedMessage): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tool_calls_json, tool_result_json, tool_call_id, thought, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResult ? JSON.stringify(message.toolResult) : null,
      message.toolCallId || null,
      message.thought || null,
      message.timestamp
    );

    const updateSession = db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`);
    updateSession.run(Date.now(), sessionId);
  }

  static getMessages(sessionId: string): UnifiedMessage[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, role, content, tool_calls_json, tool_result_json, tool_call_id, thought, timestamp
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(sessionId) as Array<{
      id: string;
      role: string;
      content: string;
      tool_calls_json: string | null;
      tool_result_json: string | null;
      tool_call_id: string | null;
      thought: string | null;
      timestamp: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      role: row.role as UnifiedMessage['role'],
      content: row.content,
      toolCalls: row.tool_calls_json ? JSON.parse(row.tool_calls_json) : undefined,
      toolResult: row.tool_result_json ? JSON.parse(row.tool_result_json) : undefined,
      toolCallId: row.tool_call_id || undefined,
      thought: row.thought || undefined,
      timestamp: row.timestamp,
    }));
  }

  static getSession(sessionId: string): SessionState | null {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, title, model, provider, cwd, permission_mode, total_input_tokens, total_output_tokens, total_cost_usd, created_at, updated_at
      FROM sessions
      WHERE id = ?
    `);
    const row = stmt.get(sessionId) as {
      id: string;
      title: string;
      model: string;
      provider: string;
      cwd: string;
      permission_mode: string;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      model: row.model,
      provider: row.provider,
      cwd: row.cwd,
      permissionMode: row.permission_mode as SessionState['permissionMode'],
      totalInputTokens: row.total_input_tokens || 0,
      totalOutputTokens: row.total_output_tokens || 0,
      totalCostUsd: row.total_cost_usd || 0.0,
    };
  }

  static findLatestSession(cwd: string): SessionState | null {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, title, model, provider, cwd, permission_mode, total_input_tokens, total_output_tokens, total_cost_usd, created_at, updated_at
      FROM sessions
      WHERE cwd = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const row = stmt.get(cwd) as {
      id: string;
      title: string;
      model: string;
      provider: string;
      cwd: string;
      permission_mode: string;
      total_input_tokens: number;
      total_output_tokens: number;
      total_cost_usd: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      model: row.model,
      provider: row.provider,
      cwd: row.cwd,
      permissionMode: row.permission_mode as SessionState['permissionMode'],
      totalInputTokens: row.total_input_tokens || 0,
      totalOutputTokens: row.total_output_tokens || 0,
      totalCostUsd: row.total_cost_usd || 0.0,
    };
  }

  static updateUsage(sessionId: string, inputTokens: number, outputTokens: number, costUsd = 0): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE sessions
      SET total_input_tokens = total_input_tokens + ?,
          total_output_tokens = total_output_tokens + ?,
          total_cost_usd = total_cost_usd + ?,
          updated_at = ?
      WHERE id = ?
    `);

    stmt.run(inputTokens, outputTokens, costUsd, Date.now(), sessionId);
  }

  static updateModel(sessionId: string, provider: string, model: string): void {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE sessions
      SET provider = ?,
          model = ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(provider, model, Date.now(), sessionId);
  }

  static recordFileSnapshot(
    sessionId: string,
    filePath: string,
    contentBefore: string,
    contentAfter: string,
    diff: string
  ): string {
    const db = getDatabase();
    const id = randomUUID();
    const stmt = db.prepare(`
      INSERT INTO file_snapshots (id, session_id, file_path, content_before, content_after, diff, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, sessionId, filePath, contentBefore, contentAfter, diff, Date.now());
    return id;
  }

  /**
   * Retrieves the list of files successfully modified or created during a session.
   */
  static getModifiedFiles(sessionId: string): string[] {
    const db = getDatabase();
    try {
      const stmt = db.prepare(`
        SELECT DISTINCT file_path
        FROM file_snapshots
        WHERE session_id = ?
        ORDER BY created_at ASC
      `);
      const rows = stmt.all(sessionId) as Array<{ file_path: string }>;
      return rows.map((r) => r.file_path);
    } catch {
      return [];
    }
  }

  /**
   * Permanently deletes a session and all its associated messages, file snapshots, tasks, and memories.
   */
  static deleteSession(sessionId: string): boolean {
    const db = getDatabase();
    try {
      db.prepare(`DELETE FROM memories WHERE session_id = ?`).run(sessionId);
      const res = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
      return (res && typeof res.changes === 'number') ? res.changes > 0 : true;
    } catch {
      try {
        db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM file_snapshots WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM tasks WHERE session_id = ?`).run(sessionId);
        const res = db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
        return (res && typeof res.changes === 'number') ? res.changes > 0 : true;
      } catch {
        return false;
      }
    }
  }
}

