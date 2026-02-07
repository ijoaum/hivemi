# Creating Custom Agents

This guide explains how to create custom AI agents for HiveMI.

## Agent Structure

Each agent is a standalone Node.js application that:

1. Registers with the Registry on startup
2. Sends periodic heartbeats
3. Listens for incoming tasks and messages
4. Processes work using an LLM
5. Reports results back to the Registry

## Quick Start

### 1. Create Agent Directory

```bash
mkdir -p agents/my-agent/src
cd agents/my-agent
```

### 2. Create package.json

```json
{
  "name": "@hivemi/agent-my-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@hivemi/agent-runtime": "workspace:*",
    "@hivemi/llm": "workspace:*",
    "@hivemi/protocol": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.7",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

### 3. Create tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 4. Create the Agent

```typescript
// src/index.ts
import { createAgent } from "@hivemi/agent-runtime";
import { complete, parseModelString } from "@hivemi/llm";
import type { Task } from "@hivemi/protocol";

// Configuration from environment
const config = {
  id: process.env.AGENT_ID || crypto.randomUUID(),
  name: process.env.AGENT_NAME || "MyAgent",
  port: parseInt(process.env.AGENT_PORT || "3005"),
  roleId: process.env.ROLE_ID || "",
  teamId: process.env.TEAM_ID || "",
  model: process.env.MODEL || "openai/gpt-4o",
  registryUrl: process.env.REGISTRY_URL || "http://localhost:4001",
  secret: process.env.HIVEMI_SECRET,
};

// Your agent's personality and capabilities
const SYSTEM_PROMPT = `You are ${config.name}, a helpful AI agent.

Your responsibilities:
1. Process incoming tasks efficiently
2. Communicate clearly and concisely
3. Ask for clarification when needed

When you receive a task:
1. Analyze the requirements
2. Execute the work
3. Return structured results
`;

const llmConfig = parseModelString(config.model);

// Create the agent
const agent = createAgent({
  id: config.id,
  name: config.name,
  roleId: config.roleId,
  teamId: config.teamId,
  model: config.model,
  port: config.port,
  registryUrl: config.registryUrl,
  secret: config.secret,
});

// Handle incoming tasks
agent.onTask(async (task: Task) => {
  console.log(`[${config.name}] Processing: ${task.title}`);

  try {
    const result = await complete(llmConfig, {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Task: ${task.title}\n\n${task.description || ""}\n\nInput: ${task.input || "None"}`,
        },
      ],
    });

    return { output: result.text };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
});

// Handle P2P messages from other agents
agent.onMessage(async (message) => {
  console.log(`[${config.name}] Message from ${message.from}: ${message.type}`);
  
  // Handle pings automatically (built into runtime)
  // Add custom message handlers here
  
  return { received: true };
});

// Start the agent
agent.start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await agent.stop();
  process.exit(0);
});
```

### 5. Run Your Agent

```bash
# Set required environment
export REGISTRY_URL=http://localhost:4001
export ROLE_ID=<your-role-id>
export TEAM_ID=<your-team-id>
export OPENAI_API_KEY=sk-...

# Start the agent
pnpm dev
```

## Agent Runtime API

### createAgent(config)

Creates a new agent instance.

```typescript
const agent = createAgent({
  id: string,          // Unique agent ID (UUID)
  name: string,        // Display name
  roleId: string,      // Role ID from Registry
  teamId: string,      // Team ID from Registry
  model: string,       // LLM model (e.g., "openai/gpt-4o")
  port: number,        // HTTP port to listen on
  registryUrl: string, // Registry URL
  secret?: string,     // Optional auth secret
});
```

### agent.onTask(handler)

Register a task handler.

```typescript
agent.onTask(async (task: Task) => {
  // Process the task
  return {
    output?: string,  // Result on success
    error?: string,   // Error message on failure
  };
});
```

### agent.onMessage(handler)

Register a P2P message handler.

```typescript
agent.onMessage(async (message: P2PMessage) => {
  // Handle the message
  return any; // Response payload
});
```

### agent.sendMessage(to, type, payload)

Send a message to another agent.

```typescript
const response = await agent.sendMessage(
  "agent-uuid",           // Target agent ID
  "agent:request",        // Message type
  { question: "..." }     // Payload
);
```

### agent.start()

Start the agent (registers with Registry, starts heartbeat).

```typescript
await agent.start();
```

### agent.stop()

Stop the agent gracefully.

```typescript
await agent.stop();
```

## LLM Integration

### complete(config, request)

Send a completion request to an LLM.

```typescript
import { complete, parseModelString } from "@hivemi/llm";

const config = parseModelString("openai/gpt-4o");

const result = await complete(config, {
  systemPrompt: "You are a helpful assistant.",
  messages: [
    { role: "user", content: "Hello!" }
  ],
  maxTokens: 1000,    // Optional
  temperature: 0.7,   // Optional
});

console.log(result.text);
console.log(result.usage); // Token usage
```

### Supported Providers

- `openai/gpt-4o`
- `openai/gpt-4o-mini`
- `anthropic/claude-3-opus-20240229`
- `anthropic/claude-3-sonnet-20240229`
- `anthropic/claude-sonnet-4-20250514`

## Best Practices

### 1. Structured Output

Use JSON in your system prompt for consistent parsing:

```typescript
const SYSTEM_PROMPT = `...
Always respond in this JSON format:
{
  "analysis": "...",
  "result": "...",
  "confidence": 0.95
}
`;
```

### 2. Error Handling

Always handle errors gracefully:

```typescript
agent.onTask(async (task) => {
  try {
    // ... process task
  } catch (error) {
    console.error("Task failed:", error);
    return { 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
});
```

### 3. Logging

Use descriptive logging:

```typescript
console.log(`[${agentName}] Starting task: ${task.title}`);
console.log(`[${agentName}] Completed in ${elapsed}ms`);
```

### 4. Environment Variables

Always use environment variables for configuration:

```typescript
const MODEL = process.env.MODEL || "openai/gpt-4o";
const PORT = parseInt(process.env.AGENT_PORT || "3001");
```

### 5. Graceful Shutdown

Always handle shutdown signals:

```typescript
process.on("SIGINT", async () => {
  await agent.stop();
  process.exit(0);
});
```

## Example Agents

See the `agents/` directory for complete examples:

- `agents/pm/` — Product Manager
- `agents/tech-lead/` — Tech Lead
- `agents/developer/` — Developer
- `agents/qa/` — QA Engineer
