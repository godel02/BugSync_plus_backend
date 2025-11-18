// cli-extension/bugCommand.js
const express = require('express');
const router = express.Router();

// Parse text format:  "Title | Body | #label1 #label2"
function parseBugText(text) {
  if (!text || typeof text !== 'string') return { title: '', body: '', labels: [] };

  const parts = text.split('|').map(p => p.trim()).filter(Boolean);

  const title = parts[0] || '';
  const body = parts[1] || '';

  // Detect labels:
  let labels = [];
  if (parts[2]) {
    labels = parts[2]
      .split(/[ ,]+/)
      .map(l => l.replace(/^#/, '').trim())
      .filter(Boolean);
  } else {
    // fallback: detect hashtags anywhere
    labels = (text.match(/#\w+/g) || []).map(t => t.replace('#',''));
  }

  return { title, body, labels };
}

// Build CLIQ card response
function buildIssueCard(issueUrl, issueNumber, matchedSnippets) {
  const snippets = (matchedSnippets || []).map(s => {
    const codeBlock = s.snippet ? `\`\`\`\n${s.snippet}\n\`\`\`` : "";
    return `**${s.title}**\n${s.description || ''}\n${codeBlock}`;
  }).join("\n\n---\n\n");

  return {
    text: `✅ Issue created: [#${issueNumber}](${issueUrl})`,
    attachments: [
      {
        title: `Issue #${issueNumber}`,
        text: issueUrl,
        type: "rich",
        fields: [
          {
            title: "Suggestions",
            value: snippets || "No relevant suggestions found",
            short: false
          }
        ]
      }
    ]
  };
}

// =========================
// POST /bug
// =========================
router.post('/bug', async (req, res) => {
  try {
    const payload = req.body || {};
    const text = payload.text || payload.message || payload.command || "";

    const { title, body, labels } = parseBugText(text);

    if (!title) {
      return res.json({
        text: "❗ Usage: /bug <title> | <description> | #labels"
      });
    }

    // Backend base URL — if not set, default to localhost
    const backendBase = process.env.BACKEND_BASE_URL || "http://localhost:3000";

    // Send data to your real backend
    const createResp = await fetch(`${backendBase}/create-issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels })
    });

    const data = await createResp.json();

    if (!createResp.ok) {
      return res.json({
        text: `⚠️ GitHub Issue Creation Failed: ${JSON.stringify(data.error)}`
      });
    }

    // Build Cliq card
    const card = buildIssueCard(data.issueUrl, data.issueNumber, data.matchedSnippets);
    return res.json(card);

  } catch (err) {
    console.error("BUG COMMAND ERROR:", err);
    return res.json({
      text: "⚠️ Internal server error while creating issue."
    });
  }
});

// =========================
// POST /bugstatus
// =========================
router.post('/bugstatus', async (req, res) => {
  try {
    const text = req.body.text || "";
    const issueNumber = text.trim().split(/\s+/)[0];

    if (!issueNumber || isNaN(Number(issueNumber))) {
      return res.json({
        text: "❗ Usage: /bugstatus <issueNumber>"
      });
    }

    const backendBase = process.env.BACKEND_BASE_URL || "http://localhost:3000";

    const statusResp = await fetch(`${backendBase}/issue-status/${issueNumber}`);
    const statusData = await statusResp.json();

    if (!statusResp.ok) {
      return res.json({
        text: `⚠️ Error fetching status: ${JSON.stringify(statusData.error)}`
      });
    }

    const reply = `Issue #${statusData.number}: ${statusData.title}\nStatus: ${statusData.state}\nURL: ${statusData.url}`;
    return res.json({ text: reply });

  } catch (err) {
    console.error("BUGSTATUS ERROR:", err);
    return res.json({
      text: "⚠️ Internal error fetching issue status."
    });
  }
});

module.exports = router;
