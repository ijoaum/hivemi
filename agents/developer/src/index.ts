import { createAgent } from "@hivemi/agent-runtime";
import { complete, parseModelString } from "@hivemi/llm";
import type { Task } from "@hivemi/protocol";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_ID = process.env.AGENT_ID || crypto.randomUUID();
const AGENT_NAME = process.env.AGENT_NAME || "Bartholomew";
const AGENT_PORT = parseInt(process.env.AGENT_PORT || "3001");
const ROLE_ID = process.env.ROLE_ID || "";
const TEAM_ID = process.env.TEAM_ID || "";
const MODEL = process.env.MODEL || "openai/gpt-4o";
const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const HIVEMI_SECRET = process.env.HIVEMI_SECRET;

// ---------------------------------------------------------------------------
// Load SOUL.md — system prompt from file (falls back to inline default)
// ---------------------------------------------------------------------------

function loadSoulMd(): string {
  const workspacePath = resolve(
    process.env.HOME || "/home/openclaw",
    ".openclaw/workspace/SOUL.md",
  );
  if (existsSync(workspacePath)) {
    return readFileSync(workspacePath, "utf-8");
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const devPath = resolve(__dirname, "../SOUL.md");
  if (existsSync(devPath)) {
    return readFileSync(devPath, "utf-8");
  }

  console.warn("[Developer] SOUL.md not found, using inline fallback");
  return `You are a senior Developer agent. Write clean, efficient, well-documented code. Follow best practices. Respond with structured JSON output.`;
}

const SYSTEM_PROMPT = loadSoulMd();

const llmConfig = parseModelString(MODEL);

const agent = createAgent({
  id: AGENT_ID,
  name: AGENT_NAME,
  roleId: ROLE_ID,
  teamId: TEAM_ID,
  model: MODEL,
  port: AGENT_PORT,
  registryUrl: REGISTRY_URL,
  secret: HIVEMI_SECRET,
});

agent.onTask(async (task: Task) => {
  console.log(`[${AGENT_NAME}] Processing task: ${task.title}`);

  try {
    const result = await complete(llmConfig, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Task: ${task.title}\n\nDescription: ${task.description || "No description"}\n\nInput: ${task.input || "No input"}`,
        },
      ],
    });

    console.log(`[${AGENT_NAME}] Task completed`);
    
    return {
      output: result.text,
    };
  } catch (error) {
    console.error(`[${AGENT_NAME}] Task failed:`, error);
    return {
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
});

agent.onMessage(async (message) => {
  console.log(`[${AGENT_NAME}] Received message:`, message.type);
  
  if (message.type === "agent:request") {
    const payload = message.payload as { question?: string };
    
    if (payload.question) {
      const result = await complete(llmConfig, {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: payload.question }],
      });
      
      return { answer: result.text };
    }
  }
  
  return { received: true };
});

agent.start().catch((err) => {
  console.error("Failed to start agent:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await agent.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await agent.stop();
  process.exit(0);
});
