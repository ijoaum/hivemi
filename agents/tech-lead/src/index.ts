import { createAgent } from "@hivemi/agent-runtime";
import { complete, parseModelString } from "@hivemi/llm";
import type { Task } from "@hivemi/protocol";

const AGENT_ID = process.env.AGENT_ID || crypto.randomUUID();
const AGENT_NAME = process.env.AGENT_NAME || "Cornelius";
const AGENT_PORT = parseInt(process.env.AGENT_PORT || "3003");
const ROLE_ID = process.env.ROLE_ID || "";
const TEAM_ID = process.env.TEAM_ID || "";
const MODEL = process.env.MODEL || "openai/gpt-4o";
const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const HIVEMI_SECRET = process.env.HIVEMI_SECRET;

const SYSTEM_PROMPT = `You are Cornelius, a Tech Lead agent in a software development team.

Your responsibilities:
1. Review technical tasks from the PM
2. Make architectural decisions
3. Define technical approach and patterns
4. Break down technical tasks for developers
5. Review code quality and ensure best practices
6. Identify technical risks and dependencies

When you receive a task:
1. Analyze the technical requirements
2. Choose appropriate technologies and patterns
3. Define the architecture or approach
4. Create implementation tasks for developers
5. Specify acceptance criteria and testing requirements

Always respond in this JSON format:
{
  "technicalAnalysis": "Your technical analysis",
  "approach": "Chosen technical approach",
  "architecture": {
    "components": ["Component 1", "Component 2"],
    "patterns": ["Pattern used"],
    "technologies": ["Tech 1", "Tech 2"]
  },
  "implementationTasks": [
    {
      "title": "Task title",
      "description": "Technical details",
      "type": "backend|frontend|database|infrastructure",
      "complexity": "low|medium|high",
      "dependencies": ["Task ID if any"]
    }
  ],
  "technicalRisks": ["Risk 1", "Risk 2"],
  "testingStrategy": "How this should be tested"
}`;

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
  console.log(`[${AGENT_NAME}] Reviewing task: ${task.title}`);

  try {
    const result = await complete(llmConfig, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Technical task received from PM:\n\nTitle: ${task.title}\n\nDescription: ${task.description || "No description"}\n\nContext: ${task.input || "None"}\n\nPlease analyze this technically and create implementation tasks.`,
        },
      ],
    });

    console.log(`[${AGENT_NAME}] Technical analysis complete`);
    
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
