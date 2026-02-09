// =============================================================================
// Output Parser
// Parses OpenClaw task execution responses to extract structured data:
// - Descriptive text (what was done)
// - PR links (GitHub pull request URLs)
// - Subtasks to create (delegated work)
// - Execution status (success/failure/needs-input)
// =============================================================================

import type { TaskArtifact } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedOutput {
  /** What was done — cleaned text summary */
  summary: string;
  /** Execution status inferred from output */
  status: "completed" | "failed" | "needs-input";
  /** PR links found in the output */
  pullRequests: TaskArtifact[];
  /** Subtasks to create (parsed from structured output) */
  subtasks: ParsedSubtask[];
  /** Raw output preserved for audit */
  rawOutput: string;
}

export interface ParsedSubtask {
  title: string;
  description: string | null;
  priority: "high" | "medium" | "low" | null;
  roleTarget: string | null;
}

// ---------------------------------------------------------------------------
// PR Link Extraction
// ---------------------------------------------------------------------------

const PR_URL_REGEX = /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/gi;

/**
 * Extract GitHub PR URLs from text.
 * Deduplicates and normalizes (removes trailing slashes, fragments).
 */
export function extractPRLinks(text: string): TaskArtifact[] {
  const matches = text.match(PR_URL_REGEX);
  if (!matches) return [];

  const unique = [...new Set(matches.map((url) => url.replace(/\/+$/, "")))];

  return unique.map((url) => ({
    type: "pull-request",
    url,
    description: `Pull Request: ${url.split("/").slice(-3).join("/")}`,
  }));
}

// ---------------------------------------------------------------------------
// Subtask Extraction
//
// Agents are instructed (via SOUL.md) to output subtasks in a structured format.
// We support two formats:
//
// 1. Markdown format (natural for LLM output):
//    ## Subtasks
//    - **Title here** — Description here [priority: high] [role: developer]
//    - **Another task** — Another description
//
// 2. JSON format (more reliable parsing):
//    ```subtasks
//    [{ "title": "...", "description": "...", "priority": "high", "roleTarget": "developer" }]
//    ```
// ---------------------------------------------------------------------------

const SUBTASK_JSON_REGEX = /```subtasks\s*\n([\s\S]*?)```/i;
const SUBTASK_MD_REGEX = /^[-*]\s+\*\*(.+?)\*\*\s*(?:—|--|-|:)\s*(.*?)$/gm;
const PRIORITY_INLINE_REGEX = /\[priority:\s*(high|medium|low)\]/i;
const ROLE_INLINE_REGEX = /\[role:\s*([\w-]+)\]/i;

/**
 * Extract subtasks from the output text.
 * Tries JSON format first (more reliable), falls back to markdown.
 */
export function extractSubtasks(text: string): ParsedSubtask[] {
  // Try JSON format first
  const jsonMatch = text.match(SUBTASK_JSON_REGEX);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as Array<{
        title?: string;
        description?: string | null;
        priority?: string | null;
        roleTarget?: string | null;
      }>;

      if (Array.isArray(parsed)) {
        return parsed
          .filter((s) => s.title && typeof s.title === "string")
          .map((s) => ({
            title: s.title!.trim(),
            description: s.description?.trim() || null,
            priority: isValidPriority(s.priority) ? s.priority : null,
            roleTarget: s.roleTarget?.trim() || null,
          }));
      }
    } catch {
      // Invalid JSON — fall through to markdown parsing
    }
  }

  // Try markdown format
  const subtasks: ParsedSubtask[] = [];
  const subtaskSection = extractSection(text, "Subtasks");
  const searchText = subtaskSection || text;

  let match: RegExpExecArray | null;
  const regex = new RegExp(SUBTASK_MD_REGEX.source, "gm");

  while ((match = regex.exec(searchText)) !== null) {
    const title = match[1].trim();
    let description = match[2].trim();

    // Extract inline priority
    const priorityMatch = description.match(PRIORITY_INLINE_REGEX);
    const priority = priorityMatch
      ? (priorityMatch[1].toLowerCase() as "high" | "medium" | "low")
      : null;

    // Extract inline role
    const roleMatch = description.match(ROLE_INLINE_REGEX);
    const roleTarget = roleMatch ? roleMatch[1].trim() : null;

    // Clean description of inline tags
    description = description
      .replace(PRIORITY_INLINE_REGEX, "")
      .replace(ROLE_INLINE_REGEX, "")
      .trim();

    subtasks.push({
      title,
      description: description || null,
      priority,
      roleTarget,
    });
  }

  return subtasks;
}

// ---------------------------------------------------------------------------
// Status Inference
//
// Infers task execution status from the output text.
// Looks for explicit markers first, then uses heuristics.
// ---------------------------------------------------------------------------

const FAILURE_MARKERS = [
  /\bfailed\b.*\b(?:task|execution|build|test|deploy)\b/i,
  /\b(?:task|execution|build|test|deploy)\b.*\bfailed\b/i,
  /\berror(?:s)?\b.*\boccurred\b/i,
  /\bcould not\b.*\bcomplete\b/i,
  /\bunable to\b.*\b(?:complete|finish|execute)\b/i,
  /\bstatus:\s*failed\b/i,
  /\bRESULT:\s*failed\b/i,
];

const NEEDS_INPUT_MARKERS = [
  /\bneed(?:s)?\s+(?:more\s+)?(?:input|information|clarification|context)\b/i,
  /\bblocked\b.*\bwaiting\b/i,
  /\bwaiting\b.*\b(?:input|response|approval)\b/i,
  /\bcannot proceed\b/i,
  /\bstatus:\s*needs[_-]?input\b/i,
  /\bRESULT:\s*needs[_-]?input\b/i,
];

const SUCCESS_MARKERS = [
  /\bsuccessfully\b.*\b(?:completed|implemented|deployed|created|merged)\b/i,
  /\b(?:completed|implemented|deployed|created|merged)\b.*\bsuccessfully\b/i,
  /\btask\s+(?:is\s+)?completed?\b/i,
  /\bstatus:\s*completed\b/i,
  /\bRESULT:\s*success\b/i,
];

/**
 * Infer task execution status from the output text.
 * Checks for explicit status markers first, then uses heuristics.
 * Default: "completed" (optimistic — most LLM outputs indicate success).
 */
export function inferStatus(text: string): "completed" | "failed" | "needs-input" {
  // Check for explicit failure markers
  for (const marker of FAILURE_MARKERS) {
    if (marker.test(text)) return "failed";
  }

  // Check for needs-input markers
  for (const marker of NEEDS_INPUT_MARKERS) {
    if (marker.test(text)) return "needs-input";
  }

  // Check for explicit success markers (reinforces default)
  for (const marker of SUCCESS_MARKERS) {
    if (marker.test(text)) return "completed";
  }

  // Default: completed (LLMs typically produce output when successful)
  return "completed";
}

// ---------------------------------------------------------------------------
// Summary Extraction
//
// Extracts a clean summary from the output, stripping subtask sections
// and JSON blocks. Truncates to a reasonable length.
// ---------------------------------------------------------------------------

const MAX_SUMMARY_LENGTH = 5000;

/**
 * Extract a clean summary from the output.
 * Removes JSON blocks, subtask sections, and excessive whitespace.
 */
export function extractSummary(text: string): string {
  let summary = text;

  // Remove JSON subtask blocks
  summary = summary.replace(SUBTASK_JSON_REGEX, "");

  // Remove fenced code blocks that are just data
  summary = summary.replace(/```(?:json|subtasks)\s*\n[\s\S]*?```/gi, "");

  // Trim excessive whitespace
  summary = summary.replace(/\n{3,}/g, "\n\n").trim();

  // Truncate if too long
  if (summary.length > MAX_SUMMARY_LENGTH) {
    summary = summary.substring(0, MAX_SUMMARY_LENGTH) + "\n\n[...truncated]";
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Main Parser
// ---------------------------------------------------------------------------

/**
 * Parse the raw output from OpenClaw task execution.
 * Extracts structured data: summary, status, PRs, subtasks.
 */
export function parseTaskOutput(rawOutput: string): ParsedOutput {
  return {
    summary: extractSummary(rawOutput),
    status: inferStatus(rawOutput),
    pullRequests: extractPRLinks(rawOutput),
    subtasks: extractSubtasks(rawOutput),
    rawOutput,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidPriority(value: unknown): value is "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low";
}

/**
 * Extract a markdown section by heading name.
 * Returns the text between the heading and the next same-level or higher heading.
 */
function extractSection(text: string, heading: string): string | null {
  const regex = new RegExp(
    `^#{1,3}\\s+${escapeRegex(heading)}\\s*$`,
    "im",
  );
  const match = regex.exec(text);
  if (!match) return null;

  const start = match.index + match[0].length;
  const nextHeading = text.substring(start).search(/^#{1,3}\s+/m);

  if (nextHeading === -1) {
    return text.substring(start).trim();
  }

  return text.substring(start, start + nextHeading).trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
