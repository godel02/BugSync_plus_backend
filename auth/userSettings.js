const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '../bugsync.sqlite');
const db = new sqlite3.Database(DB_PATH);

// create table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    repo_owner TEXT,
    repo_name TEXT
  )
`);

module.exports = {

  saveRepo(userId, owner, repo) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO user_settings (user_id, repo_owner, repo_name)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           repo_owner = excluded.repo_owner,
           repo_name = excluded.repo_name`,
        [userId, owner, repo],
        (err) => {
          if (err) reject(err);
          else resolve(true);
        }
      );
    });
  },

  getRepo(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT repo_owner, repo_name FROM user_settings WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }
};
