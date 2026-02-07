import { db, roles, teams, agents, tasks, logs } from "./db/index.js";
import { sql } from "drizzle-orm";

const seedRoles = [
  {
    name: "Product Manager",
    slug: "pm",
    description: "Analyzes requirements, creates user stories, and prioritizes the backlog",
    icon: "📋",
    color: "blue",
    capabilities: ["requirement-analysis", "story-creation", "backlog-prioritization", "stakeholder-communication"],
    systemPrompt: "You are a Product Manager agent. Your role is to understand user needs, break down requirements into actionable stories, and prioritize the product backlog. Focus on clarity, user value, and feasibility when creating stories.",
  },
  {
    name: "Tech Lead",
    slug: "tech-lead",
    description: "Makes architectural decisions, reviews code, and mentors developers",
    icon: "🧱",
    color: "purple",
    capabilities: ["architecture-design", "code-review", "technical-decisions", "mentoring"],
    systemPrompt: "You are a Tech Lead agent. Your responsibility is to ensure code quality, make architectural decisions, review pull requests, and guide the development team toward best practices and scalable solutions.",
  },
  {
    name: "Frontend Developer",
    slug: "frontend",
    description: "Builds user interfaces with React, handles styling and UX implementation",
    icon: "🎨",
    color: "cyan",
    capabilities: ["react-development", "css-styling", "component-design", "accessibility"],
    systemPrompt: "You are a Frontend Developer agent. You specialize in building beautiful, accessible user interfaces using React and modern CSS. Focus on component reusability, responsive design, and great user experience.",
  },
  {
    name: "Backend Developer",
    slug: "backend",
    description: "Develops APIs, handles database operations, and implements business logic",
    icon: "⚙️",
    color: "green",
    capabilities: ["api-development", "database-design", "business-logic", "performance-optimization"],
    systemPrompt: "You are a Backend Developer agent. You build robust APIs, design efficient database schemas, implement business logic, and optimize for performance and reliability.",
  },
  {
    name: "QA Engineer",
    slug: "qa",
    description: "Writes tests, finds bugs, and ensures software quality",
    icon: "🧪",
    color: "amber",
    capabilities: ["test-writing", "bug-detection", "quality-assurance", "test-automation"],
    systemPrompt: "You are a QA Engineer agent. Your mission is to ensure software quality through comprehensive testing strategies, including unit tests, integration tests, and end-to-end tests. Find bugs before users do.",
  },
  {
    name: "SRE / DevOps",
    slug: "sre",
    description: "Manages infrastructure, deployments, monitoring, and reliability",
    icon: "🚀",
    color: "red",
    capabilities: ["deployment", "monitoring", "infrastructure", "incident-response"],
    systemPrompt: "You are an SRE agent. You ensure system reliability, manage deployments, configure monitoring and alerting, and respond to incidents. Focus on uptime, automation, and infrastructure-as-code.",
  },
  {
    name: "Designer",
    slug: "designer",
    description: "Creates visual designs, prototypes, and design systems",
    icon: "✨",
    color: "pink",
    capabilities: ["visual-design", "prototyping", "design-systems", "user-research"],
    systemPrompt: "You are a Designer agent. You create beautiful, intuitive designs that solve user problems. Focus on design systems, visual consistency, and user-centered design principles.",
  },
  {
    name: "Data Analyst",
    slug: "analyst",
    description: "Analyzes data, creates reports, and provides insights",
    icon: "📊",
    color: "indigo",
    capabilities: ["data-analysis", "reporting", "visualization", "insights"],
    systemPrompt: "You are a Data Analyst agent. You analyze data patterns, create insightful reports and visualizations, and provide actionable business insights to drive decision-making.",
  },
];

const seedTeams = [
  {
    name: "Core Platform",
    emoji: "🏗️",
    color: "blue",
  },
  {
    name: "Product",
    emoji: "🎯",
    color: "purple",
  },
  {
    name: "Infrastructure",
    emoji: "🔧",
    color: "red",
  },
];

async function seed() {
  console.log("🌱 Seeding database...\n");

  // Check if roles already exist
  const existingRoles = await db.select({ count: sql<number>`count(*)` }).from(roles);
  const roleCount = Number(existingRoles[0].count);

  if (roleCount > 0) {
    console.log(`⚠️  Found ${roleCount} existing roles. Skipping role seed.`);
    console.log("   Use --force to clear and re-seed.\n");
    if (!process.argv.includes("--force")) {
      const existingTeams = await db.select({ count: sql<number>`count(*)` }).from(teams);
      const teamCount = Number(existingTeams[0].count);
      if (teamCount > 0) {
        console.log(`⚠️  Found ${teamCount} existing teams. Skipping team seed.\n`);
        console.log("✅ Nothing to do. Database already seeded.");
        process.exit(0);
      }
    } else {
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
  }

  // Seed roles
  if (roleCount === 0 || process.argv.includes("--force")) {
    console.log("📝 Inserting roles...");
    for (const role of seedRoles) {
      const result = await db.insert(roles).values(role).returning();
      console.log(`   ✅ ${role.icon} ${role.name} (${result[0].id})`);
    }
    console.log(`   → ${seedRoles.length} roles created.\n`);
  }

  // Seed teams
  const existingTeams = await db.select({ count: sql<number>`count(*)` }).from(teams);
  const teamCount = Number(existingTeams[0].count);

  if (teamCount === 0 || process.argv.includes("--force")) {
    console.log("📝 Inserting teams...");
    for (const team of seedTeams) {
      const result = await db.insert(teams).values(team).returning();
      console.log(`   ✅ ${team.emoji} ${team.name} (${result[0].id})`);
    }
    console.log(`   → ${seedTeams.length} teams created.\n`);
  } else {
    console.log(`⚠️  Found ${teamCount} existing teams. Skipping team seed.\n`);
  }

  console.log("✅ Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
