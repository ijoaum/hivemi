import { describe, it, expect, beforeAll, afterAll } from "vitest";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";
const MANAGER_URL = process.env.MANAGER_URL || "http://localhost:4000";

describe("HiveMI E2E Tests", () => {
  describe("Health Checks", () => {
    it("registry should be healthy", async () => {
      const res = await fetch(`${REGISTRY_URL}/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    it("manager should be healthy", async () => {
      const res = await fetch(`${MANAGER_URL}/health`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });
  });

  describe("Teams CRUD", () => {
    let teamId: string;

    it("should create a team", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Team",
          emoji: "🧪",
          color: "purple",
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("Test Team");
      teamId = data.data.id;
    });

    it("should list teams", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/teams`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  describe("Roles CRUD", () => {
    let roleId: string;

    it("should create a role", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Role",
          slug: "test-role-" + Date.now(),
          description: "A test role",
          icon: "🧪",
          color: "blue",
          capabilities: ["testing"],
          systemPrompt: "You are a test agent.",
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("Test Role");
      roleId = data.data.id;
    });

    it("should get a role by id", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/roles/${roleId}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(roleId);
    });

    it("should list roles", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/roles`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it("should delete a role", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/roles/${roleId}`, {
        method: "DELETE",
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Agents CRUD", () => {
    let agentId: string;
    let roleId: string;
    let teamId: string;

    beforeAll(async () => {
      // Create a role for testing
      const roleRes = await fetch(`${REGISTRY_URL}/api/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Agent Test Role",
          slug: "agent-test-role-" + Date.now(),
          description: "Role for agent testing",
          icon: "🤖",
          color: "green",
          capabilities: ["testing"],
          systemPrompt: "You are a test agent.",
        }),
      });
      const roleData = await roleRes.json();
      roleId = roleData.data.id;

      // Create a team for testing
      const teamRes = await fetch(`${REGISTRY_URL}/api/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Agent Test Team",
          emoji: "🤖",
          color: "green",
        }),
      });
      const teamData = await teamRes.json();
      teamId = teamData.data.id;
    });

    it("should create an agent", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Agent",
          roleId,
          teamId,
          model: "test/model",
          host: "http://localhost",
          port: 9999,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.name).toBe("Test Agent");
      agentId = data.data.id;
    });

    it("should get an agent by id", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/agents/${agentId}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(agentId);
    });

    it("should update agent status", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/agents/${agentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "idle" }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe("idle");
    });

    it("should record heartbeat", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/agents/${agentId}/heartbeat`, {
        method: "POST",
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.lastHeartbeat).toBeTruthy();
    });

    it("should list agents", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/agents`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it("should delete an agent", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/agents/${agentId}`, {
        method: "DELETE",
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Tasks Flow", () => {
    let taskId: string;
    let teamId: string;

    beforeAll(async () => {
      // Get a team
      const teamsRes = await fetch(`${REGISTRY_URL}/api/teams`);
      const teamsData = await teamsRes.json();
      teamId = teamsData.data[0]?.id;
    });

    it("should create a demand via manager", async () => {
      const res = await fetch(`${MANAGER_URL}/api/demands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "E2E Test Task",
          description: "This is an E2E test",
          priority: "medium",
          teamId,
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.task).toBeTruthy();
      taskId = data.data.task.id;
    });

    it("should get task status", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/tasks/${taskId}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.title).toBe("E2E Test Task");
    });

    it("should cancel a task", async () => {
      const res = await fetch(`${REGISTRY_URL}/api/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe("cancelled");
    });
  });

  describe("Manager Status", () => {
    it("should return cluster status", async () => {
      const res = await fetch(`${MANAGER_URL}/api/status`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.agents).toBeDefined();
      expect(data.data.roles).toBeDefined();
      expect(data.data.teams).toBeDefined();
    });
  });
});
