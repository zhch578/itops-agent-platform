import type { Database } from 'better-sqlite3';

export function up(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      request_type TEXT NOT NULL DEFAULT 'workflow',
      status TEXT NOT NULL DEFAULT 'pending',
      requester TEXT DEFAULT '',
      assignee TEXT DEFAULT '',
      related_type TEXT DEFAULT '',
      related_id TEXT DEFAULT '',
      payload TEXT DEFAULT '{}',
      reason TEXT DEFAULT '',
      approved_at TEXT,
      approved_by TEXT,
      rejected_at TEXT,
      rejected_by TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

export function down(db: Database) {
  db.exec(`DROP TABLE IF EXISTS approval_requests;`);
}

const v020_approval_requests = { up, down };
export default v020_approval_requests;
