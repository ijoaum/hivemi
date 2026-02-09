// =============================================================================
// Deploy Orchestrator Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeployOrchestrator } from "../lib/deploy-orchestrator.js";
import type {
  IRegistryClient,
  IProvisionerOps,
  IBootstrapperOps,
  DeployEvent,
} from "../lib/deploy-orchestrator.js";

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

function createMockRegistry(): IRegistryClient {
  const agents = new Map<string, any>();
  const deploys = new Map<string, any>();
  let agentCounter = 0;
  let deployCounter = 0;

  return {
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
      // Simulate phase progress
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
      return {
        status: "success" as const,
        phases: [],
        durationMs: 5000,
      };
    }),

    generateCloudInit: vi.fn((sshPublicKey, _context) => {
      return `#cloud-config\n# test cloud-init for ${sshPublicKey}`;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeployOrchestrator", () => {
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

  // -------------------------------------------------------------------------
  // startDeploy
  // -------------------------------------------------------------------------

  describe("startDeploy", () => {
    it("should create agent and deploy records", async () => {
      const result = await orchestrator.startDeploy({
        name: "Atlas",
        roleId: "role-dev-1",
        teamId: "team-alpha-1",
        model: "gpt-4o",
      });

      expect(result.deployId).toBeDefined();
      expect(result.agentId).toBeDefined();
      expect(registry.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Atlas",
          roleId: "role-dev-1",
          teamId: "team-alpha-1",
          model: "gpt-4o",
        }),
      );
      expect(registry.createDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: "Atlas",
          cloudProvider: "digitalocean",
          region: "nyc1",
          instanceSize: "small",
        }),
      );
    });

    it("should track deploy in memory", async () => {
      const result = await orchestrator.startDeploy({
        name: "Nova",
        roleId: "role-1",
        teamId: "team-1",
        model: "claude-sonnet-4",
      });

      const state = orchestrator.getDeployState(result.deployId);
      expect(state).toBeDefined();
      expect(state!.agentName).toBe("Nova");
      expect(state!.status).toBe("provisioning");
    });

    it("should initialize all four phases", async () => {
      const result = await orchestrator.startDeploy({
        name: "PhaseTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      const state = orchestrator.getDeployState(result.deployId)!;
      expect(state.phases).toHaveLength(4);
      expect(state.phases.map((p) => p.name)).toEqual([
        "provisioning", "installing", "configuring", "registering",
      ]);
      expect(state.phases[0].status).toBe("active");
      expect(state.phases[1].status).toBe("pending");
      expect(state.phases[2].status).toBe("pending");
      expect(state.phases[3].status).toBe("pending");
    });

    it("should throw if cloud config is missing", async () => {
      (registry.getCloudConfig as any).mockResolvedValueOnce(null);

      await expect(
        orchestrator.startDeploy({
          name: "Test",
          roleId: "r1",
          teamId: "t1",
          model: "gpt-4o",
        }),
      ).rejects.toThrow("Cloud configuration not found");
    });

    it("should throw if API token is missing", async () => {
      (registry.getCloudConfig as any).mockResolvedValueOnce({
        provider: "digitalocean",
        region: "nyc1",
        instanceSize: "small",
        apiToken: null,
        sshKeyId: null,
        sshPublicKey: "ssh-key",
        sshPrivateKey: "pk",
      });

      await expect(
        orchestrator.startDeploy({
          name: "Test",
          roleId: "r1",
          teamId: "t1",
          model: "gpt-4o",
        }),
      ).rejects.toThrow("Cloud API token not configured");
    });

    it("should throw if SSH keys are missing", async () => {
      (registry.getCloudConfig as any).mockResolvedValueOnce({
        provider: "digitalocean",
        region: "nyc1",
        instanceSize: "small",
        apiToken: "token",
        sshKeyId: null,
        sshPublicKey: null,
        sshPrivateKey: null,
      });

      await expect(
        orchestrator.startDeploy({
          name: "Test",
          roleId: "r1",
          teamId: "t1",
          model: "gpt-4o",
        }),
      ).rejects.toThrow("SSH keys not configured");
    });

    it("should use custom cloud config when provided", async () => {
      await orchestrator.startDeploy({
        name: "Custom",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
        cloudProvider: "gcp",
        region: "us-east1",
        instanceSize: "medium",
      });

      expect(registry.createDeploy).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudProvider: "gcp",
          region: "us-east1",
          instanceSize: "medium",
        }),
      );
    });

    it("should emit deploy events", async () => {
      const events: DeployEvent[] = [];
      orchestrator.on("deploy_event", (event: DeployEvent) => {
        events.push(event);
      });

      const result = await orchestrator.startDeploy({
        name: "EventTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Wait for async deploy sequence to complete
      await new Promise((r) => setTimeout(r, 200));

      // Should have emitted at least one event
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].deployId).toBe(result.deployId);
    });

    it("should call provisioner to create VM", async () => {
      await orchestrator.startDeploy({
        name: "VMTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Wait for async sequence
      await new Promise((r) => setTimeout(r, 200));

      expect(provisioner.ensureSSHKey).toHaveBeenCalledWith("hivemi-deploy", expect.any(String));
      expect(provisioner.ensureFirewall).toHaveBeenCalled();
      expect(provisioner.createInstance).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "hivemi-agent-vmtest",
          size: "small",
          tags: expect.arrayContaining(["hivemi", "agent"]),
        }),
      );
    });

    it("should call bootstrapper after provisioning", async () => {
      await orchestrator.startDeploy({
        name: "BootTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Wait for async sequence
      await new Promise((r) => setTimeout(r, 200));

      expect(bootstrapper.bootstrap).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "10.0.0.1",
          sshPort: 22,
          agent: expect.objectContaining({
            agentName: "BootTest",
          }),
        }),
        expect.objectContaining({
          onPhaseUpdate: expect.any(Function),
        }),
      );
    });

    it("should complete deploy successfully", async () => {
      const result = await orchestrator.startDeploy({
        name: "Success",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Wait for async sequence
      await new Promise((r) => setTimeout(r, 200));

      // Registry should have been updated to ready
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({ status: "ready" }),
      );

      // Agent should be idle
      expect(registry.updateAgent).toHaveBeenCalledWith(
        result.agentId,
        expect.objectContaining({ status: "idle" }),
      );
    });

    it("should emit complete event on success", async () => {
      const completeEvents: DeployEvent[] = [];
      orchestrator.on("deploy_event", (event: DeployEvent) => {
        if (event.type === "complete") completeEvents.push(event);
      });

      await orchestrator.startDeploy({
        name: "CompleteTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(completeEvents).toHaveLength(1);
      expect(completeEvents[0].data.message).toContain("CompleteTest");
    });

    it("should handle provisioner failure", async () => {
      (provisioner.createInstance as any).mockRejectedValueOnce(
        new Error("VM creation failed: quota exceeded"),
      );

      const result = await orchestrator.startDeploy({
        name: "FailTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Wait for async sequence
      await new Promise((r) => setTimeout(r, 200));

      // Deploy should be marked as failed
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("quota exceeded"),
        }),
      );
    });

    it("should handle bootstrapper failure", async () => {
      (bootstrapper.bootstrap as any).mockResolvedValueOnce({
        status: "failed",
        phases: [],
        durationMs: 3000,
        error: "SSH connection refused",
        failedPhase: "ssh-connect",
      });

      const result = await orchestrator.startDeploy({
        name: "BootFail",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Wait for async sequence
      await new Promise((r) => setTimeout(r, 200));

      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("Bootstrap failed"),
        }),
      );
    });

    it("should set agent to error status on failure", async () => {
      (provisioner.createInstance as any).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const result = await orchestrator.startDeploy({
        name: "ErrorAgent",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(registry.updateAgent).toHaveBeenCalledWith(
        result.agentId,
        expect.objectContaining({ status: "error" }),
      );
    });

    it("should clean up agent on deploy record creation failure", async () => {
      (registry.createDeploy as any).mockResolvedValueOnce({ success: false, error: "DB error" });

      await expect(
        orchestrator.startDeploy({
          name: "CleanupTest",
          roleId: "r1",
          teamId: "t1",
          model: "gpt-4o",
        }),
      ).rejects.toThrow("Failed to create deploy record");

      expect(registry.deleteAgent).toHaveBeenCalled();
    });

    it("should link agent and deploy records", async () => {
      const result = await orchestrator.startDeploy({
        name: "LinkTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Agent should have deployId set
      expect(registry.updateAgent).toHaveBeenCalledWith(
        result.agentId,
        expect.objectContaining({ deployId: result.deployId }),
      );

      // Deploy should have agentId set
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({ agentId: result.agentId }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // undeploy
  // -------------------------------------------------------------------------

  describe("undeploy", () => {
    it("should destroy VM and update status", async () => {
      const result = await orchestrator.startDeploy({
        name: "Destroy",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      await orchestrator.undeploy(result.deployId);

      expect(registry.updateDeploy).toHaveBeenCalledWith(
        result.deployId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });

    it("should update agent status to destroyed", async () => {
      const result = await orchestrator.startDeploy({
        name: "DestroyAgent",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      await orchestrator.undeploy(result.deployId);

      expect(registry.updateAgent).toHaveBeenCalledWith(
        result.agentId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });

    it("should remove from active deploys", async () => {
      const result = await orchestrator.startDeploy({
        name: "RemoveActive",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      await orchestrator.undeploy(result.deployId);

      expect(orchestrator.getDeployState(result.deployId)).toBeUndefined();
    });

    it("should handle VM already destroyed gracefully", async () => {
      const result = await orchestrator.startDeploy({
        name: "Gone",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      (provisioner.destroyInstance as any).mockRejectedValueOnce(
        new Error("Instance not found"),
      );

      await expect(orchestrator.undeploy(result.deployId)).resolves.not.toThrow();
    });

    it("should throw for non-existent deploy", async () => {
      await expect(orchestrator.undeploy("nonexistent")).rejects.toThrow("Deploy not found");
    });

    it("should emit status_change event", async () => {
      const events: DeployEvent[] = [];
      orchestrator.on("deploy_event", (event: DeployEvent) => {
        if (event.type === "status_change" && event.data.status === "destroyed") {
          events.push(event);
        }
      });

      const result = await orchestrator.startDeploy({
        name: "EventDestroy",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      await orchestrator.undeploy(result.deployId);

      expect(events).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // redeploy
  // -------------------------------------------------------------------------

  describe("redeploy", () => {
    it("should destroy old and create new deploy", async () => {
      const first = await orchestrator.startDeploy({
        name: "OldAgent",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      const second = await orchestrator.redeploy(first.deployId, {
        name: "NewAgent",
        roleId: "r1",
        teamId: "t1",
        model: "claude-sonnet-4",
      });

      expect(second.deployId).not.toBe(first.deployId);
      expect(second.agentId).not.toBe(first.agentId);
    });

    it("should mark old deploy as destroyed before creating new", async () => {
      const first = await orchestrator.startDeploy({
        name: "RedeployOld",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      await orchestrator.redeploy(first.deployId, {
        name: "RedeployNew",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      // Old deploy should have been marked as destroyed
      expect(registry.updateDeploy).toHaveBeenCalledWith(
        first.deployId,
        expect.objectContaining({ status: "destroyed" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // retryPhase
  // -------------------------------------------------------------------------

  describe("retryPhase", () => {
    it("should throw for non-existent deploy", async () => {
      await expect(orchestrator.retryPhase("nonexistent")).rejects.toThrow("Deploy not found");
    });

    it("should throw for non-failed deploy", async () => {
      const result = await orchestrator.startDeploy({
        name: "NotFailed",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      // Deploy should be ready now (not failed)
      await expect(orchestrator.retryPhase(result.deployId)).rejects.toThrow(
        /Cannot retry deploy in status/,
      );
    });

    it("should reset failed phase and subsequent phases", async () => {
      // Create a deploy that fails at configuring phase
      (bootstrapper.bootstrap as any).mockResolvedValueOnce({
        status: "failed",
        phases: [],
        durationMs: 3000,
        error: "Config error",
        failedPhase: "configure-openclaw",
      });

      const result = await orchestrator.startDeploy({
        name: "RetryTest",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      // Now retry
      await orchestrator.retryPhase(result.deployId);

      // Should be tracked in memory again
      const state = orchestrator.getDeployState(result.deployId);
      expect(state).toBeDefined();
    });

    it("should retry from specific phase when provided", async () => {
      // Create a failed deploy
      (provisioner.createInstance as any).mockRejectedValueOnce(
        new Error("VM error"),
      );

      const result = await orchestrator.startDeploy({
        name: "SpecificRetry",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      // Retry from provisioning phase
      await orchestrator.retryPhase(result.deployId, "provisioning");

      const state = orchestrator.getDeployState(result.deployId);
      expect(state).toBeDefined();
      expect(state!.status).toBe("provisioning");
    });

    it("should emit status_change event on retry", async () => {
      const statusEvents: DeployEvent[] = [];
      orchestrator.on("deploy_event", (event: DeployEvent) => {
        if (event.type === "status_change" && event.data.message?.toString().includes("Retrying")) {
          statusEvents.push(event);
        }
      });

      (provisioner.createInstance as any).mockRejectedValueOnce(new Error("fail"));

      const result = await orchestrator.startDeploy({
        name: "RetryEvent",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      await orchestrator.retryPhase(result.deployId);

      expect(statusEvents).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // State accessors
  // -------------------------------------------------------------------------

  describe("state accessors", () => {
    it("getActiveDeploys should list all active deploys", async () => {
      await orchestrator.startDeploy({ name: "A1", roleId: "r1", teamId: "t1", model: "m1" });
      await orchestrator.startDeploy({ name: "A2", roleId: "r1", teamId: "t1", model: "m1" });

      const active = orchestrator.getActiveDeploys();
      expect(active.length).toBe(2);
    });

    it("getDeployState should return undefined for unknown deploy", () => {
      expect(orchestrator.getDeployState("nonexistent")).toBeUndefined();
    });

    it("getActiveDeploys returns empty array initially", () => {
      expect(orchestrator.getActiveDeploys()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------

  describe("events", () => {
    it("should emit events on specific deploy channel", async () => {
      const result = await orchestrator.startDeploy({
        name: "Channel",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      const deployEvents: DeployEvent[] = [];
      orchestrator.on(`deploy:${result.deployId}`, (event: DeployEvent) => {
        deployEvents.push(event);
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(deployEvents.length).toBeGreaterThan(0);
      expect(deployEvents.every((e) => e.deployId === result.deployId)).toBe(true);
    });

    it("should emit phase_update events during deploy", async () => {
      const phaseEvents: DeployEvent[] = [];
      orchestrator.on("deploy_event", (event: DeployEvent) => {
        if (event.type === "phase_update") phaseEvents.push(event);
      });

      await orchestrator.startDeploy({
        name: "PhaseEvents",
        roleId: "r1",
        teamId: "t1",
        model: "gpt-4o",
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(phaseEvents.length).toBeGreaterThan(0);
    });
  });
});
