import { randomUUID } from 'crypto';
import { getDatabase } from '../../state/Database.js';

export interface TrajectoryRecord {
  id: string;
  sessionId: string;
  taskId: string;
  intent: string;
  prompt: string;
  stagesExecuted: string[];
  changedFiles: string[];
  status: 'SUCCESS' | 'FAILED' | 'ROLLED_BACK' | 'REJECTED';
  diffStat?: string;
  reproEvidence?: string;
  tokensUsed?: number;
  durationMs?: number;
  createdAt: number;
}

export class TrajectoryRecorder {
  /**
   * Save an execution trajectory record into SQLite database
   */
  static recordTrajectory(
    entry: Omit<TrajectoryRecord, 'id' | 'createdAt'>
  ): TrajectoryRecord {
    const db = getDatabase();
    const id = randomUUID();
    const createdAt = Date.now();

    const stmt = db.prepare(`
      INSERT INTO trajectories (
        id, session_id, task_id, intent, prompt, stages_executed,
        changed_files, status, diff_stat, repro_evidence,
        tokens_used, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.sessionId,
      entry.taskId,
      entry.intent,
      entry.prompt,
      JSON.stringify(entry.stagesExecuted),
      JSON.stringify(entry.changedFiles),
      entry.status,
      entry.diffStat || '',
      entry.reproEvidence || '',
      entry.tokensUsed || 0,
      entry.durationMs || 0,
      createdAt
    );

    return {
      id,
      ...entry,
      createdAt,
    };
  }

  /**
   * Retrieve trajectories for a specific session
   */
  static getTrajectoriesForSession(sessionId: string): TrajectoryRecord[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, session_id as sessionId, task_id as taskId, intent, prompt,
             stages_executed as stagesExecuted, changed_files as changedFiles,
             status, diff_stat as diffStat, repro_evidence as reproEvidence,
             tokens_used as tokensUsed, duration_ms as durationMs, created_at as createdAt
      FROM trajectories
      WHERE session_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(sessionId) as any[];
    return rows.map((r) => ({
      ...r,
      stagesExecuted: JSON.parse(r.stagesExecuted || '[]'),
      changedFiles: JSON.parse(r.changedFiles || '[]'),
    }));
  }

  /**
   * Retrieve recent successful trajectories for Skill Crystallization
   */
  static getRecentSuccessful(limit: number = 10): TrajectoryRecord[] {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT id, session_id as sessionId, task_id as taskId, intent, prompt,
             stages_executed as stagesExecuted, changed_files as changedFiles,
             status, diff_stat as diffStat, repro_evidence as reproEvidence,
             tokens_used as tokensUsed, duration_ms as durationMs, created_at as createdAt
      FROM trajectories
      WHERE status = 'SUCCESS'
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map((r) => ({
      ...r,
      stagesExecuted: JSON.parse(r.stagesExecuted || '[]'),
      changedFiles: JSON.parse(r.changedFiles || '[]'),
    }));
  }
}
