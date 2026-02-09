import { db, roles, teams, agents, tasks, logs } from "./db/index.js";
import { sql } from "drizzle-orm";

const seedRoles = [
  {
    name: "Product Manager",
    slug: "pm",
    description: "Analyzes requirements, creates user stories, and prioritizes the backlog",
    icon: "clipboard-list",
    color: "blue",
    capabilities: ["requirement-analysis", "story-creation", "backlog-prioritization", "stakeholder-communication"],
    systemPrompt: "You are a Product Manager agent. Your role is to understand user needs, break down requirements into actionable stories, and prioritize the product backlog. Focus on clarity, user value, and feasibility when creating stories.",
  },
  {
    name: "Tech Lead",
    slug: "tech-lead",
    description: "Makes architectural decisions, reviews code, and mentors developers",
    icon: "blocks",
    color: "purple",
    capabilities: ["architecture-design", "code-review", "technical-decisions", "mentoring"],
    systemPrompt: "You are a Tech Lead agent. Your responsibility is to ensure code quality, make architectural decisions, review pull requests, and guide the development team toward best practices and scalable solutions.",
  },
  {
    name: "Frontend Developer",
    slug: "frontend",
    description: "Builds user interfaces with React, handles styling and UX implementation",
    icon: "palette",
    color: "cyan",
    capabilities: ["react-development", "css-styling", "component-design", "accessibility"],
    systemPrompt: "You are a Frontend Developer agent. You specialize in building beautiful, accessible user interfaces using React and modern CSS. Focus on component reusability, responsive design, and great user experience.",
  },
  {
    name: "Backend Developer",
    slug: "backend",
    description: "Develops APIs, handles database operations, and implements business logic",
    icon: "cog",
    color: "green",
    capabilities: ["api-development", "database-design", "business-logic", "performance-optimization"],
    systemPrompt: "You are a Backend Developer agent. You build robust APIs, design efficient database schemas, implement business logic, and optimize for performance and reliability.",
  },
  {
    name: "QA Engineer",
    slug: "qa",
    description: "Writes tests, finds bugs, and ensures software quality",
    icon: "flask-conical",
    color: "amber",
    capabilities: ["test-writing", "bug-detection", "quality-assurance", "test-automation"],
    systemPrompt: "You are a QA Engineer agent. Your mission is to ensure software quality through comprehensive testing strategies, including unit tests, integration tests, and end-to-end tests. Find bugs before users do.",
  },
  {
    name: "SRE / DevOps",
    slug: "sre",
    description: "Manages infrastructure, deployments, monitoring, and reliability",
    icon: "rocket",
    color: "red",
    capabilities: ["deployment", "monitoring", "infrastructure", "incident-response"],
    systemPrompt: "You are an SRE agent. You ensure system reliability, manage deployments, configure monitoring and alerting, and respond to incidents. Focus on uptime, automation, and infrastructure-as-code.",
  },
  {
    name: "Designer",
    slug: "designer",
    description: "Creates visual designs, prototypes, and design systems",
    icon: "sparkles",
    color: "pink",
    capabilities: ["visual-design", "prototyping", "design-systems", "user-research"],
    systemPrompt: "You are a Designer agent. You create beautiful, intuitive designs that solve user problems. Focus on design systems, visual consistency, and user-centered design principles.",
  },
  {
    name: "Data Analyst",
    slug: "analyst",
    description: "Analyzes data, creates reports, and provides insights",
    icon: "bar-chart-3",
    color: "indigo",
    capabilities: ["data-analysis", "reporting", "visualization", "insights"],
    systemPrompt: "You are a Data Analyst agent. You analyze data patterns, create insightful reports and visualizations, and provide actionable business insights to drive decision-making.",
  },
];

const seedTeams = [
  {
    name: "Core Platform",
    emoji: "blocks",
    color: "blue",
  },
  {
    name: "Product",
    emoji: "clipboard-list",
    color: "purple",
  },
  {
    name: "Infrastructure",
    emoji: "cog",
    color: "red",
  },
];

// Agents to seed (reference role slugs and team names)
const seedAgents = [
  { name: "Alice", roleSlug: "pm", teamName: "Product", model: "gpt-4o", status: "idle" as const },
  { name: "Bob", roleSlug: "tech-lead", teamName: "Core Platform", model: "claude-sonnet-4", status: "working" as const },
  { name: "Carol", roleSlug: "frontend", teamName: "Core Platform", model: "claude-sonnet-4", status: "working" as const },
  { name: "Dave", roleSlug: "backend", teamName: "Core Platform", model: "gpt-4o", status: "idle" as const },
  { name: "Eve", roleSlug: "qa", teamName: "Product", model: "gpt-4o", status: "idle" as const },
  { name: "Frank", roleSlug: "sre", teamName: "Infrastructure", model: "claude-sonnet-4", status: "offline" as const },
  { name: "Grace", roleSlug: "designer", teamName: "Product", model: "gpt-4o", status: "working" as const },
  { name: "Hank", roleSlug: "analyst", teamName: "Infrastructure", model: "gpt-4o", status: "idle" as const },
  // Note: "online" was removed from agent_status; use "idle" for online agents
];

// Tasks to seed (reference agent names and team names)
const seedTasks = [
  // Completed tasks
  {
    title: "Design login page mockup",
    description: "Create high-fidelity mockup for the new login page with SSO options",
    status: "completed" as const,
    priority: "high" as const,
    agentName: "Grace",
    teamName: "Product",
    elapsedMs: 45000,
    hoursAgo: 8,
  },
  {
    title: "Set up CI/CD pipeline",
    description: "Configure GitHub Actions for automated testing and deployment to staging",
    status: "completed" as const,
    priority: "high" as const,
    agentName: "Frank",
    teamName: "Infrastructure",
    elapsedMs: 120000,
    hoursAgo: 12,
  },
  {
    title: "Write user story: notifications",
    description: "Break down notification feature into user stories with acceptance criteria",
    status: "completed" as const,
    priority: "medium" as const,
    agentName: "Alice",
    teamName: "Product",
    elapsedMs: 30000,
    hoursAgo: 6,
  },
  {
    title: "Review PR #42: auth middleware",
    description: "Code review for the new authentication middleware with JWT validation",
    status: "completed" as const,
    priority: "high" as const,
    agentName: "Bob",
    teamName: "Core Platform",
    elapsedMs: 25000,
    hoursAgo: 4,
  },
  {
    title: "Optimize database queries",
    description: "Profile and optimize slow queries on the agents and tasks tables",
    status: "completed" as const,
    priority: "medium" as const,
    agentName: "Dave",
    teamName: "Core Platform",
    elapsedMs: 90000,
    hoursAgo: 10,
  },
  // Running tasks
  {
    title: "Build settings page components",
    description: "Implement React components for the settings page: forms, toggles, and sections",
    status: "locked" as const,
    priority: "high" as const,
    agentName: "Carol",
    teamName: "Core Platform",
    elapsedMs: 60000,
    hoursAgo: 1,
  },
  {
    title: "Architect microservice split",
    description: "Design the architecture for splitting the monolith into registry and manager services",
    status: "locked" as const,
    priority: "high" as const,
    agentName: "Bob",
    teamName: "Core Platform",
    elapsedMs: 35000,
    hoursAgo: 0.5,
  },
  {
    title: "Design onboarding flow",
    description: "Create wireframes and prototypes for new user onboarding experience",
    status: "locked" as const,
    priority: "medium" as const,
    agentName: "Grace",
    teamName: "Product",
    elapsedMs: 40000,
    hoursAgo: 2,
  },
  // Queued tasks
  {
    title: "Write integration tests for API",
    description: "Create comprehensive integration test suite for all REST API endpoints",
    status: "queued" as const,
    priority: "medium" as const,
    agentName: null,
    teamName: "Core Platform",
    elapsedMs: null,
    hoursAgo: 0.2,
  },
  {
    title: "Set up monitoring dashboards",
    description: "Configure Grafana dashboards for system metrics, agent health, and task throughput",
    status: "queued" as const,
    priority: "low" as const,
    agentName: null,
    teamName: "Infrastructure",
    elapsedMs: null,
    hoursAgo: 0.5,
  },
  {
    title: "Analyze task completion rates",
    description: "Generate report on task completion rates, average times, and failure patterns",
    status: "queued" as const,
    priority: "medium" as const,
    agentName: null,
    teamName: "Infrastructure",
    elapsedMs: null,
    hoursAgo: 1,
  },
  {
    title: "Prioritize Q2 backlog",
    description: "Review and prioritize product backlog items for Q2 sprint planning",
    status: "queued" as const,
    priority: "high" as const,
    agentName: null,
    teamName: "Product",
    elapsedMs: null,
    hoursAgo: 0.1,
  },
  // Failed tasks
  {
    title: "Deploy to production",
    description: "Deploy latest release to production environment with zero-downtime strategy",
    status: "failed" as const,
    priority: "high" as const,
    agentName: "Frank",
    teamName: "Infrastructure",
    elapsedMs: 15000,
    hoursAgo: 3,
    error: "Connection refused: production cluster unreachable (timeout after 30s)",
  },
  {
    title: "Generate accessibility report",
    description: "Run automated accessibility audit on all public-facing pages",
    status: "failed" as const,
    priority: "medium" as const,
    agentName: "Eve",
    teamName: "Product",
    elapsedMs: 8000,
    hoursAgo: 5,
    error: "Lighthouse CLI crashed: out of memory processing /dashboard route",
  },
];

// Logs to seed (reference agent names and task titles)
const seedLogs = [
  { agentName: "Bob", level: "info", message: "Starting architecture review for microservice split" },
  { agentName: "Bob", level: "info", message: "Analyzing current monolith dependencies" },
  { agentName: "Bob", level: "warn", message: "Circular dependency detected: registry ↔ manager" },
  { agentName: "Carol", level: "info", message: "Scaffolding settings page component tree" },
  { agentName: "Carol", level: "info", message: "Implementing toggle component with Tailwind" },
  { agentName: "Carol", level: "info", message: "Building form validation with Zod" },
  { agentName: "Grace", level: "info", message: "Starting wireframe for onboarding step 1" },
  { agentName: "Grace", level: "info", message: "Exporting Figma assets for review" },
  { agentName: "Frank", level: "error", message: "Production deploy failed: connection refused" },
  { agentName: "Frank", level: "info", message: "Rolling back to previous version" },
  { agentName: "Frank", level: "info", message: "Rollback complete, production stable" },
  { agentName: "Alice", level: "info", message: "Completed notification user stories (5 stories created)" },
  { agentName: "Dave", level: "info", message: "Query optimization complete: 3x improvement on agents list" },
  { agentName: "Eve", level: "error", message: "Accessibility audit crashed on /dashboard: OOM" },
  { agentName: "Eve", level: "warn", message: "Retrying with reduced page set" },
  { agentName: "Hank", level: "info", message: "Generating weekly task completion report" },
];

async function seed() {
  console.log("🌱 Seeding database...\n");

  const isForce = process.argv.includes("--force");

  // Check existing data
  const existingRoles = await db.select({ count: sql<number>`count(*)` }).from(roles);
  const roleCount = Number(existingRoles[0].count);
  const existingTeams = await db.select({ count: sql<number>`count(*)` }).from(teams);
  const teamCount = Number(existingTeams[0].count);
  const existingAgents = await db.select({ count: sql<number>`count(*)` }).from(agents);
  const agentCount = Number(existingAgents[0].count);
  const existingTasks = await db.select({ count: sql<number>`count(*)` }).from(tasks);
  const taskCount = Number(existingTasks[0].count);

  if (roleCount > 0 && !isForce) {
    console.log(`⚠️  Database already has data (${roleCount} roles, ${teamCount} teams, ${agentCount} agents, ${taskCount} tasks).`);
    console.log("   Use --force to clear and re-seed.\n");
    console.log("✅ Nothing to do.");
    process.exit(0);
  }

  if (isForce) {
    console.log("🗑️  --force flag detected. Clearing existing data...");
    await db.delete(logs);
    console.log("   Cleared logs table.");
    await db.delete(tasks);
    console.log("   Cleared tasks table.");
    await db.delete(agents);
    console.log("   Cleared agents table.");
    await db.delete(roles);
    console.log("   Cleared roles table.");
    await db.delete(teams);
    console.log("   Cleared teams table.\n");
  }

  // Seed roles
  console.log("📝 Inserting roles...");
  const roleMap = new Map<string, string>(); // slug -> id
  for (const role of seedRoles) {
    const result = await db.insert(roles).values(role).returning();
    roleMap.set(role.slug, result[0].id);
    console.log(`   ✅ ${role.icon} ${role.name} (${result[0].id})`);
  }
  console.log(`   → ${seedRoles.length} roles created.\n`);

  // Seed teams
  console.log("📝 Inserting teams...");
  const teamMap = new Map<string, string>(); // name -> id
  for (const team of seedTeams) {
    const result = await db.insert(teams).values(team).returning();
    teamMap.set(team.name, result[0].id);
    console.log(`   ✅ ${team.emoji} ${team.name} (${result[0].id})`);
  }
  console.log(`   → ${seedTeams.length} teams created.\n`);

  // Seed agents
  console.log("🤖 Inserting agents...");
  const agentMap = new Map<string, string>(); // name -> id
  for (const agent of seedAgents) {
    const roleId = roleMap.get(agent.roleSlug);
    const teamId = teamMap.get(agent.teamName);
    if (!roleId || !teamId) {
      console.log(`   ⚠️  Skipping ${agent.name}: role or team not found`);
      continue;
    }
    const result = await db.insert(agents).values({
      name: agent.name,
      roleId,
      teamId,
      model: agent.model,
      host: "http://localhost",
      port: 3100 + agentMap.size,
      status: agent.status,
    }).returning();
    agentMap.set(agent.name, result[0].id);
    console.log(`   ✅ ${agent.name} (${agent.roleSlug}) → ${agent.teamName} [${agent.status}]`);
  }
  console.log(`   → ${agentMap.size} agents created.\n`);

  // Seed tasks
  console.log("📋 Inserting tasks...");
  const taskMap = new Map<string, string>(); // title -> id
  const now = Date.now();
  for (const task of seedTasks) {
    const teamId = teamMap.get(task.teamName);
    const agentId = task.agentName ? agentMap.get(task.agentName) || null : null;
    if (!teamId) {
      console.log(`   ⚠️  Skipping "${task.title}": team not found`);
      continue;
    }
    const createdAt = new Date(now - task.hoursAgo * 3600 * 1000);
    const startedAt = task.status !== "queued" ? new Date(createdAt.getTime() + 2000) : null;
    const completedAt = task.status === "completed" || task.status === "failed"
      ? new Date(createdAt.getTime() + (task.elapsedMs || 10000))
      : null;

    const result = await db.insert(tasks).values({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      agentId,
      teamId,
      elapsedMs: task.elapsedMs,
      error: task.error || null,
      createdAt,
      startedAt,
      completedAt,
    }).returning();
    taskMap.set(task.title, result[0].id);
    const statusIcon = task.status === "completed" ? "✅" : task.status === "locked" ? "🔄" : task.status === "failed" ? "❌" : "⏳";
    console.log(`   ${statusIcon} ${task.title} [${task.status}]`);
  }
  console.log(`   → ${taskMap.size} tasks created.\n`);

  // Seed logs
  console.log("📜 Inserting logs...");
  let logCount = 0;
  for (let i = 0; i < seedLogs.length; i++) {
    const log = seedLogs[i];
    const agentId = agentMap.get(log.agentName);
    if (!agentId) continue;

    await db.insert(logs).values({
      agentId,
      source: log.agentName.toLowerCase(),
      level: log.level as "debug" | "info" | "warn" | "error" | "lifecycle",
      message: log.message,
      timestamp: new Date(now - (seedLogs.length - i) * 60000), // 1 min apart
    });
    logCount++;
    const levelIcon = log.level === "error" ? "🔴" : log.level === "warn" ? "🟡" : "🔵";
    console.log(`   ${levelIcon} [${log.agentName}] ${log.message}`);
  }
  console.log(`   → ${logCount} logs created.\n`);

  console.log("✅ Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
