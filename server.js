require('dotenv').config();
const express = require('express');

const cliBugRouter = require('./cli-extension/bugCommand'); // adjust path

const app = express();
app.use(express.json());

const githubAuthRouter = require('./githubAuth');
app.use('/', githubAuthRouter);

app.use('/cliq/commands', cliBugRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'BugSync+ backend is running',
    time: new Date().toISOString()
  });
});

// after your /health route, add:

const fs = require('fs');
const path = require('path');

const SNIPPET_FILE = path.join(__dirname, 'snippets.json');
// load snippets (safe fallback to empty array)
let SNIPPETS = [];
try {
  SNIPPETS = JSON.parse(fs.readFileSync(SNIPPET_FILE, 'utf8'));
} catch (e) {
  console.warn('Could not load snippets.json', e.message || e);
  SNIPPETS = [];
}

// simple snippet matcher (keyword count)
function matchSnippets(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const scored = SNIPPETS.map(s => {
    const score = s.keywords.reduce((acc, k) => acc + (t.includes(k.toLowerCase()) ? 1 : 0), 0);
    return { ...s, score };
  }).filter(s => s.score > 0)
    .sort((a,b)=> b.score - a.score);
  return scored.slice(0,3).map(({id,title,snippet,description}) => ({id,title,snippet,description}));
}

// In-memory mock storage for created issues (for dev/demo only)
const CREATED_ISSUES = [];

// Real GitHub create-issue endpoint
app.post('/create-issue', async (req, res) => {
  try {
    const { title, body, labels } = req.body || {};
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Missing title' });
    }

    // Build GitHub payload
    const ghPayload = {
      title,
      body: `${body || ''}\n\nReported via: BugSync+`,
      labels: labels || ['from-cliq']
    };

    // Call GitHub Issues API
    const ghResp = await fetch(`https://api.github.com/repos/${process.env.REPO_OWNER}/${process.env.REPO_NAME}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'bugsync-plus'
      },
      body: JSON.stringify(ghPayload)
    });

    const ghData = await ghResp.json();

    // If GitHub returned an error, pass it through
    if (!ghResp.ok) {
      console.error('GitHub API error', ghData);
      return res.status(ghResp.status).json({ error: ghData });
    }

    // Save a local reference (optional)
    const issue = {
      number: ghData.number,
      title: ghData.title,
      body: ghData.body,
      url: ghData.html_url,
      state: ghData.state,
      labels: ghData.labels,
      created_at: ghData.created_at
    };
    CREATED_ISSUES.unshift(issue);

    // Run snippet matching on title+body
    const matched = matchSnippets(`${title} ${body || ''}`);

    // Return success payload
    return res.json({
      issueUrl: ghData.html_url,
      issueNumber: ghData.number,
      title: ghData.title,
      matchedSnippets: matched
    });

  } catch (err) {
    console.error('create-issue error', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// Real issue status from GitHub
app.get('/issue-status/:number', async (req, res) => {
  try {
    const num = Number(req.params.number);
    if (!num || num <= 0) return res.status(400).json({ error: 'Invalid issue number' });

    // Query GitHub
    const ghResp = await fetch(`https://api.github.com/repos/${process.env.REPO_OWNER}/${process.env.REPO_NAME}/issues/${num}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'bugsync-plus'
      }
    });
    const ghData = await ghResp.json();
    if (!ghResp.ok) return res.status(ghResp.status).json({ error: ghData });

    return res.json({
      number: ghData.number,
      title: ghData.title,
      state: ghData.state,
      assignee: ghData.assignee,
      labels: ghData.labels,
      url: ghData.html_url
    });

  } catch (err) {
    console.error('issue-status error', err);
    return res.status(500).json({ error: 'server error' });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BugSync+ server running at http://localhost:${PORT}`);
});
