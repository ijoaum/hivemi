import { createAgent } from "@hivemi/agent-runtime";
import { complete, parseModelString } from "@hivemi/llm";
import type { Task } from "@hivemi/protocol";

const AGENT_ID = process.env.AGENT_ID || crypto.randomUUID();
const AGENT_NAME = process.env.AGENT_NAME || "Reginald";
const AGENT_PORT = parseInt(process.env.AGENT_PORT || "3002");
const ROLE_ID = process.env.ROLE_ID || "";
const TEAM_ID = process.env.TEAM_ID || "";
const MODEL = process.env.MODEL || "openai/gpt-4o";
const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const HIVEMI_SECRET = process.env.HIVEMI_SECRET;

const SYSTEM_PROMPT = `You are Reginald, a Product Manager agent in a software development team.

Your responsibilities:
1. Analyze incoming demands and requirements
2. Break down complex tasks into smaller, actionable subtasks
3. Prioritize work based on business value and dependencies
4. Create clear user stories and acceptance criteria
5. Delegate tasks to appropriate team members

When you receive a task:
1. Analyze the requirements thoroughly
2. Identify the scope and complexity
3. Break it down into subtasks (typically 3-7 subtasks)
4. Assign priorities (high/medium/low)
5. Identify which role should handle each subtask

Always respond in this JSON format:
{
  "analysis": "Your analysis of the requirement",
  "subtasks": [
    {
      "title": "Subtask title",
      "description": "What needs to be done",
      "priority": "high|medium|low",
      "assignTo": "tech-lead|backend|frontend|qa|devops",
      "estimatedHours": 2
    }
  ],
  "risks": ["Potential risk 1", "Potential risk 2"],
  "questions": ["Clarifying question if any"]
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
  console.log(`[${AGENT_NAME}] Analyzing task: ${task.title}`);

  try {
    const result = await complete(llmConfig, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `New demand received:\n\nTitle: ${task.title}\n\nDescription: ${task.description || "No description provided"}\n\nAdditional context: ${task.input || "None"}\n\nPlease analyze this demand and break it down into actionable subtasks.`,
        },
      ],
    });

    console.log(`[${AGENT_NAME}] Task analyzed, creating subtasks...`);
    
    // In a real implementation, we would:
    // 1. Parse the JSON response
    // 2. Create subtasks in the registry
    // 3. Delegate to appropriate agents
    
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
