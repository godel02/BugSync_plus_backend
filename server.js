// server.js
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

// node-fetch helper for ESM import in CommonJS
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const sqlite3 = require('sqlite3').verbose();

// ===== DATABASE =====
const DB_PATH = path.join(__dirname, 'bugsync.sqlite');
const db = new sqlite3.Database(DB_PATH);

// ===== IMPORT USER SETTINGS MANAGER =====
const { getRepo } = require('./auth/userSettings');

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, "client")));

// ===== ROUTERS =====
const cliBugRouter = require('./cli-extension/bugCommand');
const githubAuthRouter = require('./auth/githubAuth'); // FIXED PATH

// Mount OAuth routes
app.use('/', githubAuthRouter);
console.log('Mounted GitHub OAuth Router');

// Mount CLI routes
app.use('/cliq/commands', cliBugRouter);

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'BugSync+ backend is running',
    time: new Date().toISOString(),
  });
});

// ===== SNIPPETS LOADING =====
const SNIPPET_FILE = path.join(__dirname, 'snippets.json');

let SNIPPETS = [];
try {
  SNIPPETS = JSON.parse(fs.readFileSync(SNIPPET_FILE, 'utf8'));
} catch (e) {
  console.warn('⚠️ Could not load snippets.json:', e.message || e);
  SNIPPETS = [];
}

// Snippet Matching Logic
function matchSnippets(text) {
  if (!text) return [];
  const t = text.toLowerCase();

  const ranked = SNIPPETS.map((s) => {
    const score = s.keywords.reduce(
      (acc, keyword) => acc + (t.includes(keyword.toLowerCase()) ? 1 : 0),
      0
    );
    return { ...s, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, 3).map(({ id, title, snippet, description }) => ({
    id,
    title,
    snippet,
    description,
  }));
}

// ===== CREATE ISSUE USING USER TOKEN + SELECTED REPO =====
app.post('/create-issue', async (req, res) => {
  try {
    const { userId, title, body, labels } = req.body || {};

    if (!userId) return res.status(400).json({ error: "Missing userId" });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Missing title' });

    // get selected repo for user
    const userRepo = await getRepo(userId);
    if (!userRepo)
      return res.status(400).json({ error: "User has not selected a repository yet." });

    const { repo_owner, repo_name } = userRepo;

    // Get OAuth token stored from /connect/github flow
    const tokenRow = await new Promise((resolve, reject) => {
      db.get(
        `SELECT access_token FROM user_tokens WHERE user_id=?`,
        [userId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    if (!tokenRow?.access_token)
      return res.status(401).json({
        error: "User must authenticate GitHub first."
      });

    const accessToken = tokenRow.access_token;

    const payload = {
      title,
      body: `${body || ''}\n\nReported via BugSync+`,
      labels: labels || ['bugsync'],
    };

    const response = await fetch(
      `https://api.github.com/repos/${repo_owner}/${repo_name}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${accessToken}`,
          'User-Agent': 'bugsync-plus',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ GitHub Error:", data);
      return res.status(response.status).json({ error: data });
    }

    const matchedSnippets = matchSnippets(`${title} ${body || ''}`);

    return res.json({
      success: true,
      issueNumber: data.number,
      issueUrl: data.html_url,
      matchedSnippets,
    });

  } catch (err) {
    console.error("🔥 Issue Creation Error:", err);
    return res.status(500).json({ error: 'Server error while creating issue' });
  }
});

// ===== GET ISSUE STATUS =====
app.get('/issue-status/:number', async (req, res) => {
  try {
    const number = Number(req.params.number);
    if (!number || number <= 0) {
      return res.status(400).json({ error: 'Invalid issue number' });
    }

    return res.json({ error: "This endpoint will also be updated to use user repo + token soon." });

  } catch (err) {
    console.error('🔥 Issue status error:', err);
    res.status(500).json({ error: 'Server error retrieving issue status' });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BugSync+ server running on port ${PORT}`);
});
