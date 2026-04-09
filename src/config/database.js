const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function resolveDatabaseFile() {
  const configuredPath = process.env.DATABASE_FILE;
  const databasePath = configuredPath
    ? path.resolve(configuredPath)
    : path.join(__dirname, '..', 'storage', 'app.sqlite');

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  return databasePath;
}

const databaseFile = resolveDatabaseFile();
const db = new DatabaseSync(databaseFile);

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some(column => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    credited INTEGER NOT NULL DEFAULT 0,
    credit_processing INTEGER NOT NULL DEFAULT 0,
    processing_started_at TEXT,
    credited_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credits_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    payment_id TEXT,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (payment_id) REFERENCES payments(id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_payments_email ON payments(email);
  CREATE INDEX IF NOT EXISTS idx_credits_ledger_user_id ON credits_ledger(user_id);
  CREATE INDEX IF NOT EXISTS idx_credits_ledger_payment_id ON credits_ledger(payment_id);
`);

ensureColumn('payments', 'webhook_attempts', 'webhook_attempts INTEGER NOT NULL DEFAULT 0');
ensureColumn('payments', 'last_webhook_error', 'last_webhook_error TEXT');
ensureColumn('payments', 'last_webhook_error_at', 'last_webhook_error_at TEXT');

function mapPayment(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    amount: row.amount,
    status: row.status,
    credited: Boolean(row.credited),
    creditProcessing: Boolean(row.credit_processing),
    webhookAttempts: row.webhook_attempts ?? 0,
    lastWebhookError: row.last_webhook_error ?? null,
    lastWebhookErrorAt: row.last_webhook_error_at ?? null,
    processingStartedAt: row.processing_started_at,
    creditedAt: row.credited_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  db,
  databaseFile,
  mapPayment
};
