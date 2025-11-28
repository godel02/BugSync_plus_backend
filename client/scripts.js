const BASE = "https://bugsync-backend-production.up.railway.app";
const userId = "test-user"; // later: dynamic or login-based

const repoSelect = document.getElementById("repoSelect");
const outputBox = document.getElementById("output");

function log(msg) {
  outputBox.textContent = typeof msg === "object" 
    ? JSON.stringify(msg, null, 2)
    : msg;
}

document.getElementById("authBtn").onclick = () => {
  window.open(`${BASE}/connect/github?userId=${userId}`, "_blank");
};

document.getElementById("saveRepoBtn").onclick = async () => {
  const repo = repoSelect.value;
  const r = await fetch(`${BASE}/save-repo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, repo })
  });

  log(await r.json());
};

document.getElementById("createIssueBtn").onclick = async () => {
  const title = document.getElementById("issueTitle").value;
  const body = document.getElementById("issueBody").value;

  const r = await fetch(`${BASE}/create-issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, title, body })
  });

  log(await r.json());
};

document.getElementById("statusBtn").onclick = async () => {
  const number = document.getElementById("issueNumber").value;
  const r = await fetch(`${BASE}/issue-status/${number}`);
  log(await r.json());
};

async function loadRepos() {
  const res = await fetch(`${BASE}/github/repos?userId=${userId}`);
  const repos = await res.json();
  repoSelect.innerHTML = repos.map(
    r => `<option value="${r.full_name}">${r.full_name}</option>`
  ).join("");
}

loadRepos();
log("Ready. Authenticate first if needed.");
