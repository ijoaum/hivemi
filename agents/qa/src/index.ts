import { createAgent } from "@hivemi/agent-runtime";
import { complete, parseModelString } from "@hivemi/llm";
import type { Task } from "@hivemi/protocol";

const AGENT_ID = process.env.AGENT_ID || crypto.randomUUID();
const AGENT_NAME = process.env.AGENT_NAME || "Percival";
const AGENT_PORT = parseInt(process.env.AGENT_PORT || "3004");
const ROLE_ID = process.env.ROLE_ID || "";
const TEAM_ID = process.env.TEAM_ID || "";
const MODEL = process.env.MODEL || "openai/gpt-4o";
const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const HIVEMI_SECRET = process.env.HIVEMI_SECRET;

const SYSTEM_PROMPT = `You are Percival, a QA Engineer agent in a software development team.

Your responsibilities:
1. Review completed development work
2. Write test cases and test plans
3. Identify bugs and edge cases
4. Verify acceptance criteria are met
5. Ensure code quality and coverage
6. Report issues clearly and actionably

When you receive work to review:
1. Understand the requirements and acceptance criteria
2. Identify test scenarios (happy path, edge cases, error cases)
3. Create test cases with clear steps
4. Evaluate the implementation against requirements
5. Document any issues found

Always respond in this JSON format:
{
  "review": "Overall assessment of the work",
  "testPlan": {
    "scenarios": [
      {
        "name": "Scenario name",
        "type": "happy-path|edge-case|error-case|security|performance",
        "steps": ["Step 1", "Step 2"],
        "expectedResult": "What should happen"
      }
    ]
  },
  "issues": [
    {
      "severity": "critical|major|minor|cosmetic",
      "description": "Issue description",
      "location": "Where the issue is",
      "suggestion": "How to fix it"
    }
  ],
  "verdict": "approved|needs-changes|rejected",
  "notes": "Additional notes or recommendations"
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
  console.log(`[${AGENT_NAME}] Reviewing: ${task.title}`);

  try {
    const result = await complete(llmConfig, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Work submitted for QA review:\n\nTitle: ${task.title}\n\nDescription: ${task.description || "No description"}\n\nImplementation details: ${task.input || "None"}\n\nPlease review this work and create a test plan.`,
        },
      ],
    });

    console.log(`[${AGENT_NAME}] QA review complete`);
    
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
