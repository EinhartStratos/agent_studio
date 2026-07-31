import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { SessionRef } from './types';

export interface SessionIndexRecord {
  sessionId: string;
  workspacePath: string;
  title?: string;
  userCopyPath?: string;
  workspaceFilePath: string;
  createdAt: number;
  updatedAt: number;
}

/** SQLite 会话索引 */
export class SessionIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.initTables();
  }

  /** 初始化表结构 */
  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        title TEXT,
        user_copy_path TEXT,
        workspace_file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    `);
  }

  /** 插入或更新会话记录 */
  upsertSession(record: SessionIndexRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, workspace_path, title, user_copy_path, workspace_file_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        workspace_path = excluded.workspace_path,
        title = excluded.title,
        user_copy_path = excluded.user_copy_path,
        workspace_file_path = excluded.workspace_file_path,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      record.sessionId,
      record.workspacePath,
      record.title ?? null,
      record.userCopyPath ?? null,
      record.workspaceFilePath,
      record.createdAt,
      record.updatedAt
    );
  }

  /** 根据工作区路径列出会话 */
  getSessionsByWorkspace(workspacePath: string): SessionIndexRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE workspace_path = ? ORDER BY updated_at DESC'
    );
    return stmt.all(workspacePath).map((row) => this.mapRow(row as Record<string, unknown>));
  }

  /** 根据 ID 获取会话 */
  getSessionById(sessionId: string): SessionIndexRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?');
    const row = stmt.get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : undefined;
  }

  /** 搜索会话标题（简单 like 查询，为后续搜索留接口） */
  searchSessions(keyword: string): SessionIndexRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM sessions WHERE title LIKE ? ORDER BY updated_at DESC"
    );
    return stmt.all(`%${keyword}%`).map((row) => this.mapRow(row as Record<string, unknown>));
  }

  /** 删除会话索引 */
  deleteSession(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE session_id = ?');
    stmt.run(sessionId);
  }

  /** 关闭数据库 */
  close(): void {
    this.db.close();
  }

  /** 映射数据库行 */
  private mapRow(row: Record<string, unknown>): SessionIndexRecord {
    return {
      sessionId: String(row.session_id),
      workspacePath: String(row.workspace_path),
      title: row.title ? String(row.title) : undefined,
      userCopyPath: row.user_copy_path ? String(row.user_copy_path) : undefined,
      workspaceFilePath: String(row.workspace_file_path),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
