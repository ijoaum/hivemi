// =============================================================================
// Undeploy Orchestrator Tests — Issue #70
//
// Tests for:
// 1. Undeploy with force flag
// 2. Undeploy blocked when agent is working
// 3. Firewall cleanup during undeploy
// 4. Task requeue during undeploy
// 5. Redeploy (destroy + deploy)
// 6. Edge cases
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeployOrchestrator, UndeployBlockedError } from "../lib/deploy-orchestrator.js";
import type {
  IRegistryClient,
  IProvisionerOps,
  IBootstrapperOps,
  DeployEvent,
} from "../lib/deploy-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

function createMockRegistry(): IRegistryClient & { _agents: Map<string, any>; _deploys: Map<string, any> } {
  const agents = new Map<string, any>();
  const deploys = new Map<string, any>();
  let agentCounter = 0;
  let deployCounter = 0;

  return {
    _agents: agents,
    _deploys: deploys,

    createAgent: vi.fn(async (data) => {
      const id = `agent-${++agentCounter}`;
      const agent = { id, ...data, status: "offline" };
      agents.set(id, agent);
      return { success: true, data: agent };
    }),

    updateAgent: vi.fn(async (id, data) => {
      const agent = agents.get(id);
      if (!agent) return { success: false, error: "Not found" };
      Object.assign(agent, data, { updatedAt: new Date() });
      return { success: true, data: agent };
    }),

    deleteAgent: vi.fn(async (id) => {
      agents.delete(id);
      return { success: true };
    }),

    getRole: vi.fn(async (id) => ({
      success: true,
      data: {
        id,
        name: "Developer",
        slug: "developer",
        systemPrompt: "You are a developer agent.",
        description: "Writes code",
        capabilities: ["code"],
      },
    })),

    createDeploy: vi.fn(async (data) => {
      const id = `deploy-${++deployCounter}`;
      const deploy = {
        id,
        ...data,
        agentId: null,
        instanceId: null,
        status: "provisioning",
        phases: [
          { name: "provisioning", status: "active", startedAt: new Date().toISOString(), completedAt: null, error: null },
          { name: "installing", status: "pending", startedAt: null, completedAt: null, error: null },
          { name: "configuring", status: "pending", startedAt: null, completedAt: null, error: null },
          { name: "registering", status: "pending", startedAt: null, completedAt: null, error: null },
        ],
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      deploys.set(id, deploy);
      return { success: true, data: deploy };
    }),

    updateDeploy: vi.fn(async (id, data) => {
      const deploy = deploys.get(id);
      if (!deploy) return { success: false, error: "Not found" };
      if (data.phase) {
        const phases = [...deploy.phases];
        const idx = phases.findIndex((p: any) => p.name === data.phase.name);
        if (idx >= 0) phases[idx] = data.phase;
        else phases.push(data.phase);
        deploy.phases = phases;
      }
      if (data.status) deploy.status = data.status;
      if (data.instanceId) deploy.instanceId = data.instanceId;
      if (data.agentId) deploy.agentId = data.agentId;
      if (data.error !== undefined) deploy.error = data.error;
      if (data.completedAt) deploy.completedAt = data.completedAt;
      return { success: true, data: deploy };
    }),

    getDeploy: vi.fn(async (id) => {
      const deploy = deploys.get(id);
      if (!deploy) return { success: false, error: "Not found" };
      return { success: true, data: deploy };
    }),

    getCloudConfig: vi.fn(async () => ({
      provider: "digitalocean",
      region: "nyc1",
      instanceSize: "small",
      apiToken: "test-api-token",
      sshKeyId: "key-123",
      sshPublicKey: "ssh-ed25519 AAAA... test",
      sshPrivateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
    })),

    requeueLockedTasks: vi.fn(async (_agentId) => ({ requeued: 0 })),
  };
}

function createMockProvisioner(): IProvisionerOps {
  return {
    createInstance: vi.fn(async (_spec) => ({
      id: "instance-123",
      publicIp: "10.0.0.1",
      privateIp: "192.168.1.1",
    })),
    waitReady: vi.fn(async (id) => ({
      id,
      publicIp: "10.0.0.1",
      privateIp: "192.168.1.1",
    })),
    destroyInstance: vi.fn(async () => {}),
    ensureSSHKey: vi.fn(async () => "sshkey-456"),
    ensureFirewall: vi.fn(async () => "fw-789"),
    addInstanceToFirewall: vi.fn(async () => {}),
    removeInstanceFromFirewall: vi.fn(async () => {}),
  };
}

function createMockBootstrapper(): IBootstrapperOps {
  return {
    bootstrap: vi.fn(async (_config, options) => {
      if (options?.onPhaseUpdate) {
        options.onPhaseUpdate([
          { name: "cloud-init", status: "completed" },
          { name: "ssh-connect", status: "completed" },
          { name: "inject-secrets", status: "running" },
        ]);
        options.onPhaseUpdate([
          { name: "inject-secrets", status: "completed" },
          { name: "configure-openclaw", status: "completed" },
          { name: "copy-role-config", status: "completed" },
          { name: "install-daemon", status: "completed" },
          { name: "wait-registration", status: "completed" },
        ]);
      }
      return { status: "success" as const, phases: [], durationMs: 5000 };
    }),
    generateCloudInit: vi.fn(() => "#cloud-config\n# test"),
  };
}

// ---------------------------------------------------------------------------
// Helper: deploy an agent and wait for completion
// ---------------------------------------------------------------------------

async function deployAgent(
  orchestrator: DeployOrchestrator,
  name = "TestAgent",
): Promise<{ deployId: string; agentId: string }> {
  const result = await orchestrator.startDeploy({
    name,
    roleId: "r1",
    teamId: "t1",
    model: "gpt-4o",
  });
  // Wait for async deploy sequence
  await new Promise((r) => setTimeout(r, 200));
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Undeploy Flow — Issue #70", () => {
  let orchestrator: DeployOrchestrator;
  let registry: ReturnType<typeof createMockRegistry>;
  let provisioner: ReturnType<typeof createMockProvisioner>;
  let bootstrapper: ReturnType<typeof createMockBootstrapper>;

  beforeEach(() => {
    registry = createMockRegistry();
    provisioner = createMockProvisioner();
    bootstrapper = createMockBootstrapper();

    orchestrator = new DeployOrchestrator({
      registry,
      provisioner,
      bootstrapper,
      controlPlaneIp: "165.245.132.133",
    });
  });

  // =========================================================================
  // Basic Undeploy
  // =========================================================================

  describe("undeploy — basic", () => {
    it("should destroy VM and mark deploy as destroyed", async () => {
      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      expect(provisioner.destroyInstance).toHaveBeenCalledWith("instance-123");
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });

    it("should mark agent as destroyed (not delete)", async () => {
      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      expect(registry.updateAgent).toHaveBeenCalledWith(
        result.agentId,
        expect.objectContaining({ status: "destroyed" }),
      );
      // Should NOT delete the agent row — kept for history
      expect(registry.deleteAgent).not.toHaveBeenCalledWith(result.agentId);
    });

    it("should remove deploy from active deploys", async () => {
      const result = await deployAgent(orchestrator);
      expect(orchestrator.getDeployState(result.deployId)).toBeDefined();

      await orchestrator.undeploy(result.deployId);
      expect(orchestrator.getDeployState(result.deployId)).toBeUndefined();
    });

    it("should emit destroyed status_change event", async () => {
      const events: DeployEvent[] = [];
      orchestrator.on("deploy_event", (e: DeployEvent) => {
        if (e.type === "status_change" && e.data.status === "destroyed") events.push(e);
      });

      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      expect(events).toHaveLength(1);
      expect(events[0].data.message).toContain("destroyed successfully");
    });

    it("should throw for non-existent deploy", async () => {
      await expect(orchestrator.undeploy("nonexistent")).rejects.toThrow("Deploy not found");
    });
  });

  // =========================================================================
  // Graceful Shutdown — Working Agent
  // =========================================================================

  describe("undeploy — graceful shutdown", () => {
    it("should block when agent is working and force is not set", async () => {
      const result = await deployAgent(orchestrator, "WorkingAgent");

      // Set agent to working status
      registry._agents.get(result.agentId)!.status = "working";

      await expect(orchestrator.undeploy(result.deployId))
        .rejects
        .toThrow(UndeployBlockedError);
    });

    it("should include agent and deploy IDs in UndeployBlockedError", async () => {
      const result = await deployAgent(orchestrator, "BlockedAgent");
      registry._agents.get(result.agentId)!.status = "working";

      try {
        await orchestrator.undeploy(result.deployId);
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(UndeployBlockedError);
        const blocked = err as UndeployBlockedError;
        expect(blocked.agentId).toBe(result.agentId);
        expect(blocked.deployId).toBe(result.deployId);
      }
    });

    it("should proceed when force=true even if agent is working", async () => {
      const result = await deployAgent(orchestrator, "ForceAgent");
      registry._agents.get(result.agentId)!.status = "working";

      await expect(orchestrator.undeploy(result.deployId, { force: true }))
        .resolves
        .not.toThrow();

      expect(provisioner.destroyInstance).toHaveBeenCalled();
    });

    it("should proceed without blocking for idle agents", async () => {
      const result = await deployAgent(orchestrator, "IdleAgent");
      registry._agents.get(result.agentId)!.status = "idle";

      await expect(orchestrator.undeploy(result.deployId))
        .resolves
        .not.toThrow();
    });

    it("should proceed without blocking for offline agents", async () => {
      const result = await deployAgent(orchestrator, "OfflineAgent");
      registry._agents.get(result.agentId)!.status = "offline";

      await expect(orchestrator.undeploy(result.deployId))
        .resolves
        .not.toThrow();
    });

    it("should proceed without blocking for unreachable agents", async () => {
      const result = await deployAgent(orchestrator, "UnreachableAgent");
      registry._agents.get(result.agentId)!.status = "unreachable";

      await expect(orchestrator.undeploy(result.deployId))
        .resolves
        .not.toThrow();
    });
  });

  // =========================================================================
  // Firewall Cleanup
  // =========================================================================

  describe("undeploy — firewall cleanup", () => {
    it("should remove instance from firewall during undeploy", async () => {
      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      expect(provisioner.removeInstanceFromFirewall).toHaveBeenCalledWith(
        "fw-789",
        "instance-123",
      );
    });

    it("should continue if firewall removal fails", async () => {
      (provisioner.removeInstanceFromFirewall as any).mockRejectedValueOnce(
        new Error("Firewall API error"),
      );

      const result = await deployAgent(orchestrator);
      await expect(orchestrator.undeploy(result.deployId)).resolves.not.toThrow();

      // Deploy should still be marked as destroyed
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });
  });

  // =========================================================================
  // Task Requeue
  // =========================================================================

  describe("undeploy — task requeue", () => {
    it("should requeue locked tasks during undeploy", async () => {
      (registry.requeueLockedTasks as any).mockResolvedValueOnce({ requeued: 3 });

      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      expect(registry.requeueLockedTasks).toHaveBeenCalledWith(result.agentId);
    });

    it("should continue if task requeue fails", async () => {
      (registry.requeueLockedTasks as any).mockRejectedValueOnce(
        new Error("DB error"),
      );

      const result = await deployAgent(orchestrator);
      await expect(orchestrator.undeploy(result.deployId)).resolves.not.toThrow();
    });

    it("should not requeue if deploy has no agentId", async () => {
      // Create a deploy without an agent (e.g. provisioning failed early)
      const deployResult = await registry.createDeploy({
        agentName: "NoAgent",
        cloudProvider: "digitalocean",
        region: "nyc1",
        instanceSize: "small",
      });

      await orchestrator.undeploy(deployResult.data!.id);

      expect(registry.requeueLockedTasks).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe("undeploy — edge cases", () => {
    it("should handle already-destroyed deploy gracefully", async () => {
      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      // Undeploy again — should not throw
      await expect(orchestrator.undeploy(result.deployId)).resolves.not.toThrow();
    });

    it("should handle VM already deleted by provider (404)", async () => {
      (provisioner.destroyInstance as any).mockRejectedValueOnce(
        new Error("Instance not found"),
      );

      const result = await deployAgent(orchestrator);
      await expect(orchestrator.undeploy(result.deployId)).resolves.not.toThrow();

      // Should still mark as destroyed
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });

    it("should handle deploy without instanceId (failed during provisioning)", async () => {
      // Create a deploy record directly (no VM was ever created)
      const deployResult = await registry.createDeploy({
        agentName: "FailedProv",
        cloudProvider: "digitalocean",
        region: "nyc1",
        instanceSize: "small",
      });

      await orchestrator.undeploy(deployResult.data!.id);

      // Should NOT call destroyInstance (no instance to destroy)
      expect(provisioner.destroyInstance).not.toHaveBeenCalled();
      // Should still mark as destroyed
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        deployResult.data!.id,
        expect.objectContaining({ status: "destroyed" }),
      );
    });

    it("should set completedAt when destroying", async () => {
      const result = await deployAgent(orchestrator);
      await orchestrator.undeploy(result.deployId);

      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({
          status: "destroyed",
          completedAt: expect.any(Date),
        }),
      );
    });
  });

  // =========================================================================
  // Redeploy
  // =========================================================================

  describe("redeploy", () => {
    it("should destroy old deploy and create new one", async () => {
      const first = await deployAgent(orchestrator, "OldAgent");

      const second = await orchestrator.redeploy(first.deployId, {
        name: "NewAgent",
        roleId: "r1",
        teamId: "t1",
        model: "claude-sonnet-4",
      });

      expect(second.deployId).not.toBe(first.deployId);
      expect(second.agentId).not.toBe(first.agentId);
    });

    it("should force destroy even if agent is working", async () => {
      const first = await deployAgent(orchestrator, "BusyRedeploy");
      registry._agents.get(first.agentId)!.status = "working";

      // Should NOT throw — redeploy always uses force
      const second = await orchestrator.redeploy(first.deployId, {
        name: "ReplacementAgent",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      expect(second.deployId).toBeDefined();
    });

    it("should mark old deploy as destroyed", async () => {
      const first = await deployAgent(orchestrator, "OldRedeploy");

      await orchestrator.redeploy(first.deployId, {
        name: "NewRedeploy",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      expect(registry.updateDeploy).toHaveBeenCalledWith(
        first.deployId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });

    it("should generate new agent name and VM", async () => {
      const first = await deployAgent(orchestrator, "Original");

      const second = await orchestrator.redeploy(first.deployId, {
        name: "Replacement",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // New deploy with new agent
      expect(second.deployId).toBeDefined();
      expect(second.agentId).toBeDefined();
    });
  });

  // =========================================================================
  // UndeployBlockedError
  // =========================================================================

  describe("UndeployBlockedError", () => {
    it("should have correct name", () => {
      const err = new UndeployBlockedError("msg", "agent-1", "deploy-1");
      expect(err.name).toBe("UndeployBlockedError");
    });

    it("should store agentId and deployId", () => {
      const err = new UndeployBlockedError("msg", "agent-1", "deploy-1");
      expect(err.agentId).toBe("agent-1");
      expect(err.deployId).toBe("deploy-1");
    });

    it("should be an instance of Error", () => {
      const err = new UndeployBlockedError("test", "a", "d");
      expect(err).toBeInstanceOf(Error);
    });
  });
});
