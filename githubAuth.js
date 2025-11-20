// githubAuth.js
const express = require('express');
const router = express.Router();
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'bugsync.sqlite');
const db = new sqlite3.Database(DB_PATH);

// ensure user_tokens table exists
db.run(`CREATE TABLE IF NOT EXISTS user_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT,
  token_type TEXT,
  scope TEXT
)`);

// STEP 1 — Redirect user to GitHub OAuth
router.get('/connect/github', (req, res) => {
  const userId = req.query.userId || 'default_user';

  const redirectUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${process.env.APP_BASE_URL}/auth/github/callback` +
    `&scope=repo` +
    `&state=${userId}`;

  return res.redirect(redirectUrl);
});

// STEP 2 — GitHub redirects here with ?code=...
router.get('/auth/github/callback', async (req, res) => {
  const { code, state: userId } = req.query;

  try {
    // exchange code for access token
    const tokenResp = await fetch(`https://github.com/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${process.env.APP_BASE_URL}/auth/github/callback`,
        state: userId
      })
    });

    const tokenData = await tokenResp.json();

    if (!tokenData.access_token) {
      console.error('OAuth error:', tokenData);
      return res.status(500).send('GitHub OAuth failed.');
    }

    // store token in SQLite
    db.run(
      `INSERT OR REPLACE INTO user_tokens (user_id, access_token, token_type, scope)
       VALUES (?, ?, ?, ?)`,
      [userId, tokenData.access_token, tokenData.token_type, tokenData.scope]
    );

    return res.send(`
      <h1>GitHub Connected Successfully 🎉</h1>
      <p>Your account is now authorized. You can close this window.</p>
    `);

  } catch (err) {
    console.error('Callback error:', err);
    return res.status(500).send('Error completing OAuth.');
  }
});


// ✅ ADD THIS: List user's GitHub repos
router.get('/github/repos', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId query param' });

    db.get(`SELECT access_token FROM user_tokens WHERE user_id = ?`, [userId], async (err, row) => {
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
            'Authorization': `token ${row.access_token}`,
            'User-Agent': 'bugsync-plus',
            'Accept': 'application/vnd.github+json'
          }
        });

        const repos = await ghResp.json();
        if (!ghResp.ok) {
          console.error('GitHub list repos error', repos);
          return res.status(ghResp.status).json({ error: repos });
        }

        const minimal = (repos || []).map(r => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          owner: r.owner.login
        }));

        return res.json(minimal);

      } catch (ghErr) {
        console.error('GitHub API call failed', ghErr);
        return res.status(500).json({ error: 'github api error' });
      }
    });

  } catch (err) {
    console.error('repos route error', err);
    return res.status(500).json({ error: 'server error' });
  }
});


// END — export router
module.exports = router;
