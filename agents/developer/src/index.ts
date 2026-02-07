import { createAgent } from "@hivemi/agent-runtime";
import { complete, parseModelString } from "@hivemi/llm";
import type { Task } from "@hivemi/protocol";

const AGENT_ID = process.env.AGENT_ID || crypto.randomUUID();
const AGENT_NAME = process.env.AGENT_NAME || "Bartholomew";
const AGENT_PORT = parseInt(process.env.AGENT_PORT || "3001");
const ROLE_ID = process.env.ROLE_ID || "";
const TEAM_ID = process.env.TEAM_ID || "";
const MODEL = process.env.MODEL || "openai/gpt-4o";
const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const HIVEMI_SECRET = process.env.HIVEMI_SECRET;

const SYSTEM_PROMPT = `You are Bartholomew, a senior backend developer agent.
You write clean, efficient, and well-documented code.
You follow best practices and design patterns.
You communicate clearly and concisely.

When given a task:
1. Analyze the requirements
2. Break down the implementation steps
3. Write the code
4. Explain your decisions

Always respond with structured output including:
- analysis: Your understanding of the task
- implementation: The code or solution
- notes: Any important considerations`;

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
    // Handle inter-agent requests
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

// Start the agent
agent.start().catch((err) => {
  console.error("Failed to start agent:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await agent.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await agent.stop();
  process.exit(0);
});
