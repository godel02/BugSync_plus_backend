// ===== CONFIG =====
const BASE = "https://bugsync-backend-production.up.railway.app"; 

// Unique user ID saved locally
let userId = localStorage.getItem("BugSyncUser") || "user-" + Math.random().toString(36).slice(2);
localStorage.setItem("BugSyncUser", userId);

// ===== DOM ELEMENTS =====
const repoSelect = document.getElementById("repoSelect");
const outputBox = document.getElementById("output");
const authStatus = document.getElementById("authStatus");

// ===== HELPERS =====
function log(msg) {
  outputBox.textContent = typeof msg === "object"
    ? JSON.stringify(msg, null, 2)
    : msg;
}

// Toast message
function notify(msg, type = "info") {
  if (typeof toast !== "function") console.warn("Toast.js not loaded.");
  else toast(msg, type);
}

// ===== AUTH STATUS CHECK =====
async function checkAuth() {
  try {
    const res = await fetch(`${BASE}/debug/token?userId=${userId}`);
    const data = await res.json();

    if (data.found) {
      authStatus.textContent = "Connected ✓";
      authStatus.classList.add("connected");
      notify("GitHub Connected", "success");
    } else {
      authStatus.textContent = "Not Connected";
      authStatus.classList.remove("connected");
      notify("Please authenticate GitHub", "info");
    }
  } catch (e) {
    console.error(e);
    notify("Connection check failed", "error");
  }
}

// ===== LOAD REPOSITORIES =====
async function loadRepos() {
  try {
    const res = await fetch(`${BASE}/github/repos?userId=${userId}`);
    const repos = await res.json();

    if (!Array.isArray(repos)) {
      repoSelect.innerHTML = `<option>Not connected or no repo access</option>`;
      return;
    }

    repoSelect.innerHTML = repos
      .map(r => `<option value="${r.full_name}">${r.full_name}</option>`)
      .join("");

    // Restore saved repo selection
    const savedRepo = localStorage.getItem("BugSyncRepo");
    if (savedRepo) repoSelect.value = savedRepo;

  } catch (err) {
    console.error(err);
    repoSelect.innerHTML = `<option>Error loading repos</option>`;
  }
}

// ===== BUTTON ACTIONS =====

// --- 1️⃣ Authenticate GitHub ---
document.getElementById("authBtn").onclick = () => {
  window.open(`${BASE}/connect/github?userId=${userId}`, "_blank");
  notify("Authentication popup opened", "info");
};

// --- 2️⃣ Save selected repository ---
document.getElementById("saveRepoBtn").onclick = async () => {
  const repo = repoSelect.value;

  localStorage.setItem("BugSyncRepo", repo);

  const res = await fetch(`${BASE}/save-repo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, repo }),
  });

  const result = await res.json();
  log(result);
  notify("Repository saved!", "success");
};

// --- 3️⃣ Create GitHub Issue ---
document.getElementById("createIssueBtn").onclick = async () => {
  const title = document.getElementById("issueTitle").value;
  const body = document.getElementById("issueBody").value;

  if (!title.trim()) return notify("Title is required", "error");

  const res = await fetch(`${BASE}/create-issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, title, body }),
  });

  const result = await res.json();
  log(result);

  if (result.issueUrl) notify("Issue created!", "success");
  else notify("Failed to create issue", "error");
};

// --- 4️⃣ Check Issue Status ---
document.getElementById("statusBtn").onclick = async () => {
  const num = document.getElementById("issueNumber").value;
  if (!num.trim()) return notify("Enter issue number", "error");

  const res = await fetch(`${BASE}/issue-status/${num}`);
  const result = await res.json();
  log(result);

  notify("Status fetched", "info");
};

// --- 5️⃣ Clear Output ---
document.getElementById("clearOutputBtn").onclick = () => {
  log("");
  notify("Cleared", "info");
};

// ===== INITIAL RUN =====
checkAuth();
loadRepos();
log("Ready. Authenticate if needed.");
