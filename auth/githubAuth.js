// githubAuth.js
const express = require('express');
const router = express.Router();
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// lazy import for node-fetch (ESM in CJS)
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

// ===== CONFIG =====
const APP_BASE_URL = process.env.APP_BASE_URL;

if (!APP_BASE_URL) {
  console.warn('⚠️ APP_BASE_URL is not set. GitHub OAuth redirects may fail.');
}
if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) {
  console.warn('⚠️ GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is not set.');
}

// ===== SQLITE SETUP =====
const DB_PATH = path.join(__dirname, 'bugsync.sqlite');
const db = new sqlite3.Database(DB_PATH);

// ensure user_tokens table exists
db.run(`
  CREATE TABLE IF NOT EXISTS user_tokens (
    user_id TEXT PRIMARY KEY,
    access_token TEXT,
    token_type TEXT,
    scope TEXT
  )
`);

// ===== STEP 1 — Redirect user to GitHub OAuth =====
router.get('/connect/github', (req, res) => {
  const userId = req.query.userId || 'default_user';

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${APP_BASE_URL}/auth/github/callback`,
    scope: 'repo',
    state: userId,
  });

  const redirectUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  console.log('Redirecting to GitHub OAuth:', redirectUrl);
  return res.redirect(redirectUrl);
});

// ===== STEP 2 — GitHub redirects here with ?code=... =====
router.get('/auth/github/callback', async (req, res) => {
  const code = req.query.code;
  const userId = req.query.state || 'default_user';

  if (!code) {
    return res.status(400).send('Missing "code" from GitHub.');
  }

  try {
    // exchange code for access token
    const body = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${APP_BASE_URL}/auth/github/callback`,
      state: userId,
    });

    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body,
    });

    const tokenData = await tokenResp.json();
    console.log('GitHub token response:', tokenData);

    if (tokenData.error || !tokenData.access_token) {
      console.error('OAuth error:', tokenData);
      const msg =
        tokenData.error_description ||
        tokenData.error ||
        'GitHub did not return an access token.';
      return res.status(500).send(`GitHub OAuth failed: ${msg}`);
    }

    // store / upsert token in SQLite
    db.run(
      `INSERT INTO user_tokens (user_id, access_token, token_type, scope)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         token_type   = excluded.token_type,
         scope        = excluded.scope`,
      [userId, tokenData.access_token, tokenData.token_type, tokenData.scope || ''],
      (err) => {
        if (err) {
          console.error('Error saving token to DB:', err);
          return res.status(500).send('Error saving OAuth token.');
        }

        return res.send(`
          <h1>GitHub Connected Successfully 🎉</h1>
          <p>Your account is now authorized. You can close this window.</p>
        `);
      }
    );
  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Error completing OAuth.');
  }
});

// ===== List user's GitHub repos =====
router.get('/github/repos', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'Missing userId query param' });

  db.get(
    `SELECT access_token FROM user_tokens WHERE user_id = ?`,
    [userId],
    async (err, row) => {
      if (err) {
        console.error('DB error fetching token', err);
        return res.status(500).json({ error: 'server error' });
      }
      if (!row || !row.access_token) {
        return res.status(401).json({ error: 'Not connected' });
      }

      try {
        const ghResp = await fetch('https://api.github.com/user/repos?per_page=100', {
          headers: {
            Authorization: `token ${row.access_token}`,
            'User-Agent': 'bugsync-plus',
            Accept: 'application/vnd.github+json',
          },
        });

        const repos = await ghResp.json();
        if (!ghResp.ok) {
          console.error('GitHub list repos error', repos);
          return res.status(ghResp.status).json({ error: repos });
        }

        const minimal = (repos || []).map((r) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          owner: r.owner?.login,
        }));

        return res.json(minimal);
      } catch (ghErr) {
        console.error('GitHub API call failed', ghErr);
        return res.status(500).json({ error: 'github api error' });
      }
    }
  );
});

// ===== DEV DEBUG: show stored token for a user (dev only) =====
router.get('/debug/token', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'missing userId' });

  db.get(
    `SELECT * FROM user_tokens WHERE user_id = ?`,
    [userId],
    (err, row) => {
      if (err) {
        console.error('debug token db error', err);
        return res.status(500).json({ error: 'db error' });
      }
      if (!row) return res.json({ found: false });

      // only return minimal info; this is dev-only
      return res.json({
        found: true,
        userId: row.user_id,
        scope: row.scope,
      });
    }
  );
});

// END — export router
module.exports = router;
