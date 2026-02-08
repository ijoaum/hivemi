#!/usr/bin/env node

/**
 * HiveMI Issue Runner
 *
 * Executes GitHub issues sequentially using OpenClaw's Chat Completions API.
 * Each issue runs in a fresh session with no context carryover.
 *
 * Usage:
 *   node runner.js                    # Run all queued issues
 *   node runner.js --dry-run          # Show what would run without executing
 *   node runner.js --issue 69         # Run a specific issue only
 *   node runner.js --label deploy-system  # Filter by label
 *   node runner.js --status           # Show current queue status
 *
 * Config (env vars):
 *   OPENCLAW_GATEWAY_URL    - Gateway URL (default: http://127.0.0.1:18789)
 *   OPENCLAW_GATEWAY_TOKEN  - Gateway auth token
 *   GITHUB_TOKEN            - GitHub API token
 *   GITHUB_REPO             - owner/repo (default: ijoaum/hivemi)
 *   ISSUE_QUEUE             - Comma-separated issue numbers (overrides tracker)
 *   OPENCLAW_MODEL          - Model to use (default: openclaw:main)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

// ─── Paths ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const HIVEMI_ROOT = join(__dirname, "../..");
const CONTEXT_DIR = join(HIVEMI_ROOT, ".context");
const TRACKER_PATH = join(CONTEXT_DIR, "issue-tracker.json");
const RUNS_DIR = join(CONTEXT_DIR, "runs");
const LOG_PATH = join(CONTEXT_DIR, "runner.log");

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG = {
  gatewayUrl:
    process.env.OPENCLAW_GATEWAY_URL || "http://127.0.0.1:18789",
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  githubRepo: process.env.GITHUB_REPO || "ijoaum/hivemi",
  model: process.env.OPENCLAW_MODEL || "openclaw:main",
  // Allowed issue authors — only run issues created by these users
  allowedAuthors: (process.env.ALLOWED_AUTHORS || "ijoaum,clawdiabot26")
    .split(",")
    .map((s) => s.trim().toLowerCase()),
  // Max time per issue (ms) — default 30min
  issueTimeoutMs: parseInt(process.env.ISSUE_TIMEOUT_MS || "1800000", 10),
  // Delay between issues (ms) — let things settle
  delayBetweenMs: parseInt(process.env.DELAY_BETWEEN_MS || "5000", 10),
};

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(level, msg, data = null) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  if (data) console.log(JSON.stringify(data, null, 2));

  // Also append to file
  try {
    const fileLine = data
      ? `${line} ${JSON.stringify(data)}\n`
      : `${line}\n`;
    writeFileSync(LOG_PATH, fileLine, { flag: "a" });
  } catch {}
}

// ─── Secrets ─────────────────────────────────────────────────────────────────

function loadSecrets() {
  // Try 1Password if tokens not set via env
  if (!CONFIG.gatewayToken) {
    try {
      const tokenPath = join(
        process.env.HOME || "/home/openclaw",
        ".openclaw/openclaw.json"
      );
      const config = JSON.parse(readFileSync(tokenPath, "utf-8"));
      CONFIG.gatewayToken = config?.gateway?.auth?.token || "";
    } catch {}
  }

  if (!CONFIG.githubToken) {
    try {
      const opToken = readFileSync(
        join(
          process.env.HOME || "/home/openclaw",
          ".openclaw/secrets/op_token"
        ),
        "utf-8"
      ).trim();
      CONFIG.githubToken = execSync(
        `OP_SERVICE_ACCOUNT_TOKEN="${opToken}" op read "op://Clawdia/GitHub Token/credential"`,
        { encoding: "utf-8" }
      ).trim();
    } catch (e) {
      log("warn", "Could not load GitHub token from 1Password", {
        error: e.message,
      });
    }
  }

  if (!CONFIG.gatewayToken) {
    log("error", "No gateway token. Set OPENCLAW_GATEWAY_TOKEN or configure openclaw.json");
    process.exit(1);
  }
  if (!CONFIG.githubToken) {
    log("error", "No GitHub token. Set GITHUB_TOKEN or configure 1Password");
    process.exit(1);
  }
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

function loadTracker() {
  if (existsSync(TRACKER_PATH)) {
    return JSON.parse(readFileSync(TRACKER_PATH, "utf-8"));
  }
  return {
    currentIssue: null,
    status: "idle",
    completedIssues: [],
    issueQueue: [],
    updatedAt: new Date().toISOString(),
  };
}

function saveTracker(tracker) {
  tracker.updatedAt = new Date().toISOString();
  if (!existsSync(CONTEXT_DIR)) mkdirSync(CONTEXT_DIR, { recursive: true });
  writeFileSync(TRACKER_PATH, JSON.stringify(tracker, null, 2) + "\n");
}

// ─── GitHub API ──────────────────────────────────────────────────────────────

async function githubFetch(path) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${CONFIG.githubToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchIssue(number) {
  return githubFetch(`/repos/${CONFIG.githubRepo}/issues/${number}`);
}

async function fetchIssueComments(number) {
  return githubFetch(
    `/repos/${CONFIG.githubRepo}/issues/${number}/comments?per_page=50`
  );
}

async function updateIssueLabels(number, labels) {
  const url = `https://api.github.com/repos/${CONFIG.githubRepo}/issues/${number}/labels`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${CONFIG.githubToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ labels }),
  });
}

async function addIssueComment(number, body) {
  const url = `https://api.github.com/repos/${CONFIG.githubRepo}/issues/${number}/comments`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${CONFIG.githubToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
}

async function closeIssue(number) {
  const url = `https://api.github.com/repos/${CONFIG.githubRepo}/issues/${number}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `token ${CONFIG.githubToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }
  log("info", `Issue #${number} closed on GitHub`);
}

// ─── OpenClaw Chat Completions API ───────────────────────────────────────────

async function executeTask(prompt, issueNumber) {
  const url = `${CONFIG.gatewayUrl}/v1/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.issueTimeoutMs
  );

  try {
    log("info", `Sending task to OpenClaw for issue #${issueNumber}...`);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CONFIG.gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenClaw API ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content || "(empty response)";

    return {
      success: true,
      content,
      usage: data?.usage || {},
      model: data?.model || CONFIG.model,
    };
  } catch (e) {
    if (e.name === "AbortError") {
      return {
        success: false,
        content: `TIMEOUT: Issue #${issueNumber} exceeded ${CONFIG.issueTimeoutMs / 1000}s limit`,
        error: "timeout",
      };
    }
    return { success: false, content: e.message, error: "api_error" };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildPrompt(issue, comments) {
  const checklist = extractChecklist(issue.body || "");
  const commentContext = comments
    .slice(-5)
    .map((c) => `**${c.user.login}** (${c.created_at}):\n${c.body}`)
    .join("\n\n---\n\n");

  return `# Task: Implement GitHub Issue #${issue.number}

## Title
${issue.title}

## Description
${issue.body || "(no description)"}

${commentContext ? `## Recent Comments\n${commentContext}` : ""}

## Instructions

You are implementing this issue for the HiveMI project.

**Project location:** /home/openclaw/.openclaw/workspace/hivemi
**Branch:** dev
**Stack:** Next.js 16 dashboard, Hono APIs, Drizzle + Postgres, pnpm monorepo

### Rules:
1. Read the project structure and existing code before making changes
2. Read the journal at \`.context/journal.md\` for architecture context and decisions
3. Make atomic commits — each functional step gets its own commit
4. Run builds/tests to verify your changes work
5. Commit directly to the \`dev\` branch — no PRs needed
6. Push your commits when done: \`git push origin dev\`

### After completing the implementation:
1. **Update the journal** at \`.context/journal.md\` — add a new section for this issue with what was done, key decisions, and any notes for future issues
2. **Commit the journal update** as a separate commit: \`docs: journal - issue #${issue.number} completed\`
3. **Push all commits** to the remote

### Commit convention:
- feat: new functionality
- fix: bug fixes
- refactor: code restructuring
- docs: documentation
- chore: tooling, deps, config

### Output:
When you finish, end your response with a summary:
\`\`\`
RESULT: success|partial|failed
COMMITS: <number of commits>
SUMMARY: <one line summary>
\`\`\`
`;
}

function extractChecklist(body) {
  const lines = body.split("\n");
  return lines
    .filter((l) => /^\s*-\s*\[[ x]\]/.test(l))
    .map((l) => l.trim())
    .join("\n");
}

// ─── Run Persistence ─────────────────────────────────────────────────────────

function saveRun(issueNumber, result) {
  if (!existsSync(RUNS_DIR)) mkdirSync(RUNS_DIR, { recursive: true });

  const runFile = join(
    RUNS_DIR,
    `issue-${issueNumber}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  writeFileSync(
    runFile,
    JSON.stringify(
      {
        issue: issueNumber,
        timestamp: new Date().toISOString(),
        success: result.success,
        model: result.model,
        usage: result.usage,
        contentLength: result.content?.length || 0,
        // Save first/last 2000 chars to avoid huge files
        contentHead: result.content?.substring(0, 2000),
        contentTail:
          result.content?.length > 4000
            ? result.content?.substring(result.content.length - 2000)
            : undefined,
        error: result.error,
      },
      null,
      2
    ) + "\n"
  );

  log("info", `Run saved to ${runFile}`);
}

function parseResult(content) {
  const match = content.match(
    /RESULT:\s*(success|partial|failed)[\s\S]*?COMMITS:\s*(\d+)[\s\S]*?SUMMARY:\s*(.+)/
  );
  if (match) {
    return {
      status: match[1],
      commits: parseInt(match[2], 10),
      summary: match[3].trim(),
    };
  }
  return { status: "unknown", commits: 0, summary: "Could not parse result" };
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

async function runIssue(issueNumber, dryRun = false) {
  log("info", `\n${"=".repeat(60)}`);
  log("info", `Processing issue #${issueNumber}`);
  log("info", "=".repeat(60));

  // Fetch issue details from GitHub
  const issue = await fetchIssue(issueNumber);
  log("info", `Title: ${issue.title}`);
  log("info", `State: ${issue.state}`);
  log(
    "info",
    `Labels: ${issue.labels.map((l) => l.name).join(", ") || "none"}`
  );

  if (issue.state === "closed") {
    log("warn", `Issue #${issueNumber} is already closed, skipping`);
    return { skipped: true, reason: "closed" };
  }

  // Check author allowlist
  const author = (issue.user?.login || "").toLowerCase();
  if (!CONFIG.allowedAuthors.includes(author)) {
    log(
      "warn",
      `Issue #${issueNumber} author "${issue.user?.login}" not in allowlist [${CONFIG.allowedAuthors.join(", ")}], skipping`
    );
    return { skipped: true, reason: "unauthorized_author" };
  }

  // Fetch comments for context
  const comments = await fetchIssueComments(issueNumber);
  log("info", `Comments: ${comments.length}`);

  // Build prompt
  const prompt = buildPrompt(issue, comments);

  if (dryRun) {
    log("info", "[DRY RUN] Would send prompt:");
    log("info", prompt.substring(0, 500) + "...");
    return { skipped: true, reason: "dry-run" };
  }

  // Label issue as in-progress
  await updateIssueLabels(issueNumber, ["in-progress"]).catch(() => {});

  // Execute via Chat Completions API
  const startTime = Date.now();
  const result = await executeTask(prompt, issueNumber);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  log(
    result.success ? "info" : "error",
    `Issue #${issueNumber} completed in ${elapsed}s`,
    {
      success: result.success,
      contentLength: result.content?.length,
      usage: result.usage,
    }
  );

  // Save run data
  saveRun(issueNumber, result);

  // Parse result
  const parsed = parseResult(result.content || "");
  log("info", `Result: ${parsed.status} | Commits: ${parsed.commits} | ${parsed.summary}`);

  // Comment on issue with result
  const statusEmoji =
    parsed.status === "success"
      ? "✅"
      : parsed.status === "partial"
        ? "⚠️"
        : "❌";
  await addIssueComment(
    issueNumber,
    `## ${statusEmoji} Automated Implementation Run

**Status:** ${parsed.status}
**Commits:** ${parsed.commits}
**Duration:** ${elapsed}s
**Model:** ${result.model || CONFIG.model}

### Summary
${parsed.summary}

---
*Run by issue-runner at ${new Date().toISOString()}*`
  ).catch((e) => log("warn", `Failed to comment on issue: ${e.message}`));

  // Remove in-progress label
  if (parsed.status === "success") {
    await updateIssueLabels(issueNumber, ["done"]).catch(() => {});
    // Close the issue
    await closeIssue(issueNumber).catch((e) =>
      log("warn", `Failed to close issue: ${e.message}`)
    );
  }

  return { ...result, parsed, elapsed };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") flags.dryRun = true;
    if (args[i] === "--status") flags.status = true;
    if (args[i] === "--issue" && args[i + 1]) {
      flags.singleIssue = parseInt(args[++i], 10);
    }
    if (args[i] === "--label" && args[i + 1]) flags.label = args[++i];
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
HiveMI Issue Runner — Execute GitHub issues via OpenClaw Chat Completions API

Usage:
  node runner.js                        Run all queued issues sequentially
  node runner.js --dry-run              Show what would run without executing
  node runner.js --issue 69             Run a specific issue only
  node runner.js --status               Show current queue status
  node runner.js --help                 Show this help

Environment:
  OPENCLAW_GATEWAY_URL                  Gateway URL (default: http://127.0.0.1:18789)
  OPENCLAW_GATEWAY_TOKEN                Gateway auth token
  GITHUB_TOKEN                          GitHub API token
  GITHUB_REPO                           owner/repo (default: ijoaum/hivemi)
  OPENCLAW_MODEL                        Model to use (default: openclaw:main)
  ISSUE_TIMEOUT_MS                      Max time per issue in ms (default: 1800000)
  DELAY_BETWEEN_MS                      Delay between issues in ms (default: 5000)
`);
      process.exit(0);
    }
  }

  // Load secrets from config/1password
  loadSecrets();

  // Status command
  if (flags.status) {
    const tracker = loadTracker();
    console.log("\n📊 HiveMI Issue Runner Status\n");
    console.log(`  Status:    ${tracker.status}`);
    console.log(`  Current:   ${tracker.currentIssue || "(none)"}`);
    console.log(`  Completed: [${tracker.completedIssues.join(", ")}]`);
    console.log(`  Queue:     [${tracker.issueQueue.join(", ")}]`);
    console.log(`  Updated:   ${tracker.updatedAt}`);
    console.log(`  Gateway:   ${CONFIG.gatewayUrl}`);
    console.log(`  Model:     ${CONFIG.model}`);
    console.log(`  Authors:   [${CONFIG.allowedAuthors.join(", ")}]`);
    console.log();
    process.exit(0);
  }

  // Load tracker
  const tracker = loadTracker();

  // Determine which issues to run
  let queue;
  if (flags.singleIssue) {
    queue = [flags.singleIssue];
  } else if (process.env.ISSUE_QUEUE) {
    queue = process.env.ISSUE_QUEUE.split(",").map((n) => parseInt(n.trim(), 10));
  } else {
    // Use tracker queue, skip completed
    queue = tracker.issueQueue.filter(
      (n) => !tracker.completedIssues.includes(n)
    );
  }

  if (queue.length === 0) {
    log("info", "🎉 No issues to process. All done!");
    process.exit(0);
  }

  log("info", `\n🚀 Starting issue runner`);
  log("info", `Queue: [${queue.join(", ")}] (${queue.length} issues)`);
  log("info", `Model: ${CONFIG.model}`);
  log("info", `Timeout per issue: ${CONFIG.issueTimeoutMs / 1000}s`);
  log("info", `Dry run: ${flags.dryRun || false}\n`);

  const results = [];

  for (let i = 0; i < queue.length; i++) {
    const issueNumber = queue[i];

    // Update tracker
    tracker.currentIssue = issueNumber;
    tracker.status = "running";
    saveTracker(tracker);

    try {
      const result = await runIssue(issueNumber, flags.dryRun);
      results.push({ issue: issueNumber, ...result });

      if (!result.skipped) {
        // Mark complete in tracker
        if (result.success && result.parsed?.status === "success") {
          if (!tracker.completedIssues.includes(issueNumber)) {
            tracker.completedIssues.push(issueNumber);
          }
        }

        // Delay between issues
        if (i < queue.length - 1) {
          log(
            "info",
            `Waiting ${CONFIG.delayBetweenMs / 1000}s before next issue...`
          );
          await new Promise((r) => setTimeout(r, CONFIG.delayBetweenMs));
        }
      }
    } catch (e) {
      log("error", `Fatal error on issue #${issueNumber}: ${e.message}`);
      results.push({ issue: issueNumber, success: false, error: e.message });
    }
  }

  // Final tracker update
  tracker.currentIssue = null;
  tracker.status = "idle";
  saveTracker(tracker);

  // Summary
  log("info", `\n${"=".repeat(60)}`);
  log("info", "🏁 Run complete!\n");
  for (const r of results) {
    const icon = r.skipped ? "⏭️" : r.success ? "✅" : "❌";
    const detail = r.parsed?.summary || r.reason || r.error || "";
    log("info", `  ${icon} #${r.issue} — ${detail}`);
  }
  log("info", "");
}

main().catch((e) => {
  log("error", `Runner crashed: ${e.message}`);
  process.exit(1);
});
