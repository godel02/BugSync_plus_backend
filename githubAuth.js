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

module.exports = router;
