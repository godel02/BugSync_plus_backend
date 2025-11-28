// server.js
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');

// node-fetch (ESM import in CommonJS)
const fetch = (...args) =>
  import('node-fetch').then(({ default: f }) => f(...args));

const app = express();
app.use(express.json());

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

// Snippet scoring logic
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

// ===== TEMP MEMORY FOR DEV =====
const CREATED_ISSUES = [];

// ===== CREATE ISSUE ON GITHUB =====
app.post('/create-issue', async (req, res) => {
  try {
    const { title, body, labels } = req.body || {};
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Missing issue title' });
    }

    if (!process.env.REPO_OWNER || !process.env.REPO_NAME || !process.env.GITHUB_TOKEN) {
      return res.status(500).json({ 
        error: 'GitHub environment variables are missing (REPO_OWNER, REPO_NAME, GITHUB_TOKEN)' 
      });
    }

    const payload = {
      title,
      body: `${body || ''}\n\nReported via BugSync+`,
      labels: labels || ['from-cliq'],
    };

    const response = await fetch(
      `https://api.github.com/repos/${process.env.REPO_OWNER}/${process.env.REPO_NAME}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          'User-Agent': 'bugsync-plus',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ GitHub Issue Error:', data);
      return res.status(response.status).json({ error: data });
    }

    // Store locally for debug
    CREATED_ISSUES.unshift(data);

    const matchedSnippets = matchSnippets(`${title} ${body || ''}`);

    res.json({
      issueNumber: data.number,
      issueUrl: data.html_url,
      title: data.title,
      matchedSnippets,
    });

  } catch (err) {
    console.error('🔥 Issue creation error:', err);
    res.status(500).json({ error: 'Server error while creating issue' });
  }
});

// ===== GET ISSUE STATUS =====
app.get('/issue-status/:number', async (req, res) => {
  try {
    const number = Number(req.params.number);
    if (!number || number <= 0) {
      return res.status(400).json({ error: 'Invalid issue number' });
    }

    const response = await fetch(
      `https://api.github.com/repos/${process.env.REPO_OWNER}/${process.env.REPO_NAME}/issues/${number}`,
      {
        method: 'GET',
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          'User-Agent': 'bugsync-plus',
          Accept: 'application/vnd.github+json',
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ GitHub Issue Status Error:', data);
      return res.status(response.status).json({ error: data });
    }

    res.json({
      number: data.number,
      title: data.title,
      state: data.state,
      labels: data.labels,
      assignee: data.assignee,
      url: data.html_url,
    });

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
