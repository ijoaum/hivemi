#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";

const REGISTRY_URL = process.env.HIVEMI_REGISTRY_URL || "http://localhost:4001";
const MANAGER_URL = process.env.HIVEMI_MANAGER_URL || "http://localhost:4000";

const program = new Command();

program
  .name("hivemi")
  .description("🐝 HiveMI CLI - Manage your AI agent swarm")
  .version("0.1.0");

// ============================================================================
// AGENTS
// ============================================================================

const agents = program.command("agents").description("Manage agents");

agents
  .command("list")
  .alias("ls")
  .description("List all agents")
  .option("-s, --status <status>", "Filter by status")
  .option("-t, --team <team>", "Filter by team")
  .action(async (options) => {
    const spinner = ora("Fetching agents...").start();
    try {
      const res = await fetch(`${REGISTRY_URL}/api/agents`);
      const data = await res.json() as { success: boolean; data?: unknown[] };
      
      if (!data.success) throw new Error("Failed to fetch agents");
      
      spinner.stop();
      
      const agents = data.data as Array<{
        id: string;
        name: string;
        status: string;
        model: string;
        lastHeartbeat: string;
      }>;

      if (agents.length === 0) {
        console.log(chalk.yellow("No agents found"));
        return;
      }

      console.log(chalk.bold("\n🐝 Agents:\n"));
      
      for (const agent of agents) {
        const statusIcon = 
          agent.status === "working" ? "🔄" :
          agent.status === "idle" ? "✅" :
          agent.status === "error" ? "❌" : "⭕";
        
        console.log(`  ${statusIcon} ${chalk.bold(agent.name)} (${agent.id.slice(0, 8)}...)`);
        console.log(`     Status: ${agent.status} | Model: ${agent.model}`);
        console.log(`     Last heartbeat: ${agent.lastHeartbeat || "Never"}\n`);
      }
    } catch (error) {
      spinner.fail("Failed to fetch agents");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

agents
  .command("get <id>")
  .description("Get agent details")
  .action(async (id) => {
    const spinner = ora("Fetching agent...").start();
    try {
      const res = await fetch(`${REGISTRY_URL}/api/agents/${id}`);
      const data = await res.json() as { success: boolean; data?: unknown; error?: string };
      
      if (!data.success) throw new Error(data.error || "Agent not found");
      
      spinner.stop();
      console.log(chalk.bold("\n🐝 Agent Details:\n"));
      console.log(JSON.stringify(data.data, null, 2));
    } catch (error) {
      spinner.fail("Failed to fetch agent");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// ============================================================================
// ROLES
// ============================================================================

const roles = program.command("roles").description("Manage roles");

roles
  .command("list")
  .alias("ls")
  .description("List all roles")
  .action(async () => {
    const spinner = ora("Fetching roles...").start();
    try {
      const res = await fetch(`${REGISTRY_URL}/api/roles`);
      const data = await res.json() as { success: boolean; data?: unknown[] };
      
      if (!data.success) throw new Error("Failed to fetch roles");
      
      spinner.stop();
      
      const roles = data.data as Array<{
        id: string;
        name: string;
        slug: string;
        icon: string;
        description: string;
        capabilities: string[];
      }>;

      if (roles.length === 0) {
        console.log(chalk.yellow("No roles found"));
        return;
      }

      console.log(chalk.bold("\n📋 Roles:\n"));
      
      for (const role of roles) {
        console.log(`  ${role.icon} ${chalk.bold(role.name)} (${role.slug})`);
        console.log(`     ${role.description}`);
        console.log(`     Capabilities: ${role.capabilities.join(", ")}\n`);
      }
    } catch (error) {
      spinner.fail("Failed to fetch roles");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// ============================================================================
// TASKS
// ============================================================================

const tasks = program.command("tasks").description("Manage tasks");

tasks
  .command("list")
  .alias("ls")
  .description("List all tasks")
  .option("-s, --status <status>", "Filter by status")
  .option("-l, --limit <limit>", "Limit results", "20")
  .action(async (options) => {
    const spinner = ora("Fetching tasks...").start();
    try {
      const res = await fetch(`${REGISTRY_URL}/api/tasks`);
      const data = await res.json() as { success: boolean; data?: unknown[] };
      
      if (!data.success) throw new Error("Failed to fetch tasks");
      
      spinner.stop();
      
      const tasks = data.data as Array<{
        id: string;
        title: string;
        status: string;
        priority: string;
        createdAt: string;
      }>;

      if (tasks.length === 0) {
        console.log(chalk.yellow("No tasks found"));
        return;
      }

      console.log(chalk.bold("\n📝 Tasks:\n"));
      
      for (const task of tasks.slice(0, parseInt(options.limit))) {
        const statusIcon = 
          task.status === "completed" ? "✅" :
          task.status === "running" ? "🔄" :
          task.status === "failed" ? "❌" :
          task.status === "queued" ? "⏳" : "⭕";
        
        const priorityColor = 
          task.priority === "high" ? chalk.red :
          task.priority === "medium" ? chalk.yellow : chalk.gray;
        
        console.log(`  ${statusIcon} ${chalk.bold(task.title.slice(0, 50))}${task.title.length > 50 ? "..." : ""}`);
        console.log(`     ID: ${task.id.slice(0, 8)}... | ${task.status} | ${priorityColor(task.priority)}\n`);
      }
    } catch (error) {
      spinner.fail("Failed to fetch tasks");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

tasks
  .command("create <title>")
  .description("Create a new task")
  .option("-d, --description <desc>", "Task description")
  .option("-p, --priority <priority>", "Priority (high/medium/low)", "medium")
  .option("-t, --team <teamId>", "Team ID (required)")
  .action(async (title, options) => {
    if (!options.team) {
      console.error(chalk.red("Team ID is required. Use --team <teamId>"));
      process.exit(1);
    }

    const spinner = ora("Creating task...").start();
    try {
      const res = await fetch(`${MANAGER_URL}/api/demands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: options.description,
          priority: options.priority,
          teamId: options.team,
        }),
      });
      
      const data = await res.json() as { success: boolean; data?: unknown; error?: string };
      
      if (!data.success) throw new Error(data.error || "Failed to create task");
      
      spinner.succeed("Task created successfully!");
      console.log(chalk.gray(JSON.stringify(data.data, null, 2)));
    } catch (error) {
      spinner.fail("Failed to create task");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

tasks
  .command("retry <id>")
  .description("Retry a failed task")
  .action(async (id) => {
    const spinner = ora("Retrying task...").start();
    try {
      const res = await fetch(`${REGISTRY_URL}/api/tasks/${id}/retry`, {
        method: "POST",
      });
      
      const data = await res.json() as { success: boolean; error?: string };
      
      if (!data.success) throw new Error(data.error || "Failed to retry task");
      
      spinner.succeed("Task queued for retry");
    } catch (error) {
      spinner.fail("Failed to retry task");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// ============================================================================
// TEAMS
// ============================================================================

const teams = program.command("teams").description("Manage teams");

teams
  .command("list")
  .alias("ls")
  .description("List all teams")
  .action(async () => {
    const spinner = ora("Fetching teams...").start();
    try {
      const res = await fetch(`${REGISTRY_URL}/api/teams`);
      const data = await res.json() as { success: boolean; data?: unknown[] };
      
      if (!data.success) throw new Error("Failed to fetch teams");
      
      spinner.stop();
      
      const teams = data.data as Array<{
        id: string;
        name: string;
        emoji: string;
        color: string;
      }>;

      if (teams.length === 0) {
        console.log(chalk.yellow("No teams found"));
        return;
      }

      console.log(chalk.bold("\n👥 Teams:\n"));
      
      for (const team of teams) {
        console.log(`  ${team.emoji} ${chalk.bold(team.name)} (${team.id.slice(0, 8)}...)`);
      }
      console.log();
    } catch (error) {
      spinner.fail("Failed to fetch teams");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// ============================================================================
// STATUS
// ============================================================================

program
  .command("status")
  .description("Show cluster status")
  .action(async () => {
    const spinner = ora("Fetching status...").start();
    try {
      const res = await fetch(`${MANAGER_URL}/api/status`);
      const data = await res.json() as { success: boolean; data?: {
        agents: { total: number; online: number; working: number; idle: number; error: number };
        roles: number;
        teams: number;
        timestamp: string;
      }};
      
      if (!data.success || !data.data) throw new Error("Failed to fetch status");
      
      spinner.stop();
      
      const status = data.data;
      
      console.log(chalk.bold("\n🐝 HiveMI Cluster Status\n"));
      console.log(`  Agents: ${status.agents.total} total`);
      console.log(`    ✅ Idle: ${status.agents.idle}`);
      console.log(`    🔄 Working: ${status.agents.working}`);
      console.log(`    ❌ Error: ${status.agents.error}`);
      console.log(`    ⭕ Offline: ${status.agents.total - status.agents.online}`);
      console.log(`  Roles: ${status.roles}`);
      console.log(`  Teams: ${status.teams}`);
      console.log(chalk.gray(`\n  Last updated: ${status.timestamp}\n`));
    } catch (error) {
      spinner.fail("Failed to fetch status");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      console.log(chalk.yellow("\nMake sure the Manager is running at " + MANAGER_URL));
      process.exit(1);
    }
  });

program.parse();
