const { db } = require('../config/database');

function now() {
  return new Date().toISOString();
}

function getUserByEmail(email) {
  return db.prepare(
    `SELECT id, name, email, credits
     FROM users
     WHERE email = ?`
  ).get(email) || null;
}

function registerUser({ name, email }) {
  const timestamp = now();

  const result = db.prepare(
    `INSERT OR IGNORE INTO users (name, email, credits, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`
  ).run(name, email, timestamp, timestamp);

  return {
    created: result.changes > 0,
    user: getUserByEmail(email)
  };
}

function addCredit(email, amount = 1, options = {}) {
  const timestamp = now();
  const user = getUserByEmail(email);

  if (!user) {
    return null;
  }

  db.exec('BEGIN IMMEDIATE');

  try {
    db.prepare(
      `UPDATE users
       SET credits = credits + ?,
           updated_at = ?
       WHERE email = ?`
    ).run(amount, timestamp, email);

    db.prepare(
      `INSERT INTO credits_ledger (user_id, payment_id, delta, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      user.id,
      options.paymentId || null,
      amount,
      options.reason || 'manual_credit',
      timestamp
    );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return getUserByEmail(email);
}

function consumeCredit(email) {
  const timestamp = now();
  const user = getUserByEmail(email);

  if (!user) {
    return false;
  }

  db.exec('BEGIN IMMEDIATE');

  try {
    const result = db.prepare(
      `UPDATE users
       SET credits = credits - 1,
           updated_at = ?
       WHERE email = ?
         AND credits > 0`
    ).run(timestamp, email);

    if (result.changes === 0) {
      db.exec('ROLLBACK');
      return false;
    }

    db.prepare(
      `INSERT INTO credits_ledger (user_id, payment_id, delta, reason, created_at)
       VALUES (?, NULL, -1, 'tarot_reading', ?)`
    ).run(user.id, timestamp);

    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  registerUser,
  getUserByEmail,
  addCredit,
  consumeCredit
};
