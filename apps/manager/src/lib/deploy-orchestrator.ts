// =============================================================================
// Deploy Orchestrator
// Coordinates the full deploy lifecycle: provision → bootstrap → register
//
// This is the brain of the deploy system. It:
//   1. Creates a deploy record in the Registry
//   2. Creates a VM via the Provisioner
//   3. Bootstraps the VM (secrets, OpenClaw, role config, daemon)
//   4. Waits for the daemon to register
//   5. Updates deploy status at each phase
//
// All operations are async and emit events for SSE streaming.
// =============================================================================

import { EventEmitter } from "node:events";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployRequest {
  /** Agent name (e.g. "Atlas") */
  name: string;
  /** Role ID for agent config */
  roleId: string;
  /** Team ID */
  teamId: string;
  /** LLM model */
  model: string;
  /** Cloud provider (default: from settings) */
  cloudProvider?: "digitalocean" | "gcp";
  /** Region (default: from settings) */
  region?: string;
  /** Instance size (default: from settings) */
  instanceSize?: "small" | "medium" | "large";
}

export interface DeployPhase {
  name: string;
  status: "pending" | "active" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface DeployEvent {
  type: "phase_update" | "status_change" | "log" | "error" | "complete";
  deployId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export type DeployStatus =
  | "provisioning"
  | "installing"
  | "configuring"
  | "registering"
  | "ready"
  | "failed"
  | "destroyed";

export interface DeployState {
  id: string;
  agentId: string | null;
  agentName: string;
  instanceId: string | null;
  status: DeployStatus;
  phases: DeployPhase[];
  error: string | null;
  startedAt: string;
}

// Phase timeout configuration (ms)
const PHASE_TIMEOUTS: Record<string, number> = {
  provisioning: 2 * 60 * 1000,   // 2 min
  installing: 10 * 60 * 1000,    // 10 min
  configuring: 5 * 60 * 1000,    // 5 min
  registering: 2 * 60 * 1000,    // 2 min
};

// ---------------------------------------------------------------------------
// Registry Client Interface (decoupled from concrete implementation)
// ---------------------------------------------------------------------------

export interface IRegistryClient {
  createDeploy(data: {
    agentName: string;
    cloudProvider: string;
    region: string;
    instanceSize: string;
  }): Promise<{ success: boolean; data?: any }>;

  updateDeploy(deployId: string, data: {
    status?: string;
    instanceId?: string;
    agentId?: string;
    error?: string;
    phase?: DeployPhase;
    completedAt?: Date;
  }): Promise<{ success: boolean; data?: any }>;

  getDeploy(deployId: string): Promise<{ success: boolean; data?: any }>;

  createAgent(data: {
    name: string;
    roleId: string;
    teamId: string;
    model: string;
    host: string;
    port: number;
  }): Promise<{ success: boolean; data?: any }>;

  updateAgent(agentId: string, data: Record<string, unknown>): Promise<{ success: boolean; data?: any }>;

  deleteAgent(agentId: string): Promise<{ success: boolean }>;

  getRole(roleId: string): Promise<{ success: boolean; data?: any }>;

  getCloudConfig(): Promise<{
    provider: string;
    region: string;
    instanceSize: string;
    apiToken: string | null;
    sshKeyId: string | null;
    sshPublicKey: string | null;
    sshPrivateKey: string | null;
  } | null>;

  /** Requeue all tasks locked by a specific agent (set status back to "queued") */
  requeueLockedTasks(agentId: string): Promise<{ requeued: number }>;
}

// ---------------------------------------------------------------------------
// Provisioner Interface (decoupled for testing)
// ---------------------------------------------------------------------------

export interface IProvisionerOps {
  createInstance(spec: {
    name: string;
    region: string;
    size: "small" | "medium" | "large";
    sshKeyId: string;
    userData?: string;
    tags: string[];
    firewallId?: string;
  }): Promise<{ id: string; publicIp: string | null; privateIp: string | null }>;

  waitReady(instanceId: string, options?: { timeoutMs?: number }): Promise<{
    id: string;
    publicIp: string | null;
    privateIp: string | null;
  }>;

  destroyInstance(instanceId: string): Promise<void>;

  ensureSSHKey(name: string, publicKey: string): Promise<string>;

  ensureFirewall(name: string, rules: any[]): Promise<string>;

  addInstanceToFirewall(firewallId: string, instanceId: string): Promise<void>;

  removeInstanceFromFirewall(firewallId: string, instanceId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Bootstrapper Interface
// ---------------------------------------------------------------------------

export interface IBootstrapperOps {
  bootstrap(config: any, options?: any): Promise<{
    status: "success" | "failed";
    phases: any[];
    durationMs: number;
    error?: string;
    failedPhase?: string;
  }>;

  generateCloudInit(sshPublicKey: string, context?: {
    enableSwap: boolean;
    swapSizeMb?: number;
    hostname?: string;
    releaseUrl?: string;
    ghToken?: string;
  }): string;
}

// ---------------------------------------------------------------------------
// Deploy Orchestrator
// ---------------------------------------------------------------------------

export class DeployOrchestrator extends EventEmitter {
  private readonly registry: IRegistryClient;
  private readonly provisioner: IProvisionerOps;
  private readonly bootstrapper: IBootstrapperOps;
  readonly controlPlaneIp: string;

  // Active deploys tracked in memory
  private readonly activeDeploys = new Map<string, DeployState>();

  constructor(options: {
    registry: IRegistryClient;
    provisioner: IProvisionerOps;
    bootstrapper: IBootstrapperOps;
    controlPlaneIp: string;
  }) {
    super();
    this.registry = options.registry;
    this.provisioner = options.provisioner;
    this.bootstrapper = options.bootstrapper;
    this.controlPlaneIp = options.controlPlaneIp;
  }

  // -------------------------------------------------------------------------
  // Deploy — Main Entry Point
  // -------------------------------------------------------------------------

  /**
   * Start a full deploy sequence.
   * Returns immediately with the deploy ID; the actual work runs async.
   */
  async startDeploy(request: DeployRequest): Promise<{ deployId: string; agentId: string }> {
    // 1. Get cloud config for defaults
    const cloudConfig = await this.registry.getCloudConfig();
    if (!cloudConfig) {
      throw new Error("Cloud configuration not found. Please configure cloud settings first.");
    }
    if (!cloudConfig.apiToken) {
      throw new Error("Cloud API token not configured. Please add your provider token in Settings.");
    }
    if (!cloudConfig.sshPublicKey || !cloudConfig.sshPrivateKey) {
      throw new Error("SSH keys not configured. Please generate SSH keys in Settings.");
    }

    const provider = (request.cloudProvider || cloudConfig.provider) as "digitalocean" | "gcp";
    const region = request.region || cloudConfig.region;
    const instanceSize = (request.instanceSize || cloudConfig.instanceSize) as "small" | "medium" | "large";

    // 2. Create agent in registry (status: provisioning)
    const agentResult = await this.registry.createAgent({
      name: request.name,
      roleId: request.roleId,
      teamId: request.teamId,
      model: request.model,
      host: "http://pending",
      port: 3100,
    });

    if (!agentResult.success || !agentResult.data) {
      throw new Error("Failed to create agent in registry");
    }

    const agentId = agentResult.data.id;

    // Set agent to provisioning status
    await this.registry.updateAgent(agentId, { status: "provisioning" });

    // 3. Create deploy record in registry
    const deployResult = await this.registry.createDeploy({
      agentName: request.name,
      cloudProvider: provider,
      region,
      instanceSize,
    });

    if (!deployResult.success || !deployResult.data) {
      // Cleanup: delete the agent we just created
      await this.registry.deleteAgent(agentId).catch(() => {});
      throw new Error("Failed to create deploy record in registry");
    }

    const deployId = deployResult.data.id;

    // Link agent to deploy
    await this.registry.updateAgent(agentId, { deployId });
    await this.registry.updateDeploy(deployId, { agentId });

    // Track in memory
    const state: DeployState = {
      id: deployId,
      agentId,
      agentName: request.name,
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
    };
    this.activeDeploys.set(deployId, state);

    // 4. Run deploy sequence async (don't await)
    this.runDeploySequence(deployId, agentId, request, {
      provider,
      region,
      instanceSize,
      cloudConfig,
    }).catch((err) => {
      logger.error({ deployId, error: err.message }, "Deploy sequence failed unexpectedly");
    });

    return { deployId, agentId };
  }

  // -------------------------------------------------------------------------
  // Deploy Sequence — Runs Asynchronously
  // -------------------------------------------------------------------------

  private async runDeploySequence(
    deployId: string,
    agentId: string,
    request: DeployRequest,
    config: {
      provider: "digitalocean" | "gcp";
      region: string;
      instanceSize: "small" | "medium" | "large";
      cloudConfig: NonNullable<Awaited<ReturnType<IRegistryClient["getCloudConfig"]>>>;
    },
  ): Promise<void> {
    const { provider, region, instanceSize, cloudConfig } = config;
    let instanceId: string | null = null;

    try {
      // =====================================================================
      // Phase 1: Provisioning — Create VM
      // =====================================================================
      this.emitEvent(deployId, "log", { message: "Starting VM provisioning..." });

      // Ensure SSH key is registered with provider
      const sshKeyId = await this.provisioner.ensureSSHKey(
        "hivemi-deploy",
        cloudConfig.sshPublicKey!,
      );

      // Ensure firewall exists
      const firewallId = await this.provisioner.ensureFirewall(
        "hivemi-agents",
        [], // Rules handled internally by ensureFirewall
      );

      // Generate cloud-init with bootstrap script context
      const agentHostname = `hivemi-agent-${request.name.toLowerCase()}`;
      const cloudInit = this.bootstrapper.generateCloudInit(cloudConfig.sshPublicKey!, {
        enableSwap: instanceSize === "small",
        swapSizeMb: 2048,
        hostname: agentHostname,
        releaseUrl: cloudConfig.releaseUrl,
        ghToken: cloudConfig.ghToken,
      });

      // Create VM
      const instance = await this.provisioner.createInstance({
        name: `hivemi-agent-${request.name.toLowerCase()}`,
        region,
        size: instanceSize,
        sshKeyId,
        userData: cloudInit,
        tags: ["hivemi", "agent", `role-${request.roleId}`],
        firewallId,
      });

      instanceId = instance.id;
      this.emitEvent(deployId, "log", { message: `VM created: ${instance.id}` });

      // Update registry with instance ID
      await this.registry.updateDeploy(deployId, { instanceId: instance.id });

      // Wait for VM to be active
      const readyInstance = await this.provisioner.waitReady(instance.id, {
        timeoutMs: PHASE_TIMEOUTS.provisioning,
      });

      // Add instance to firewall
      await this.provisioner.addInstanceToFirewall(firewallId, instance.id);

      // Update agent with host info
      const publicIp = readyInstance.publicIp || "";
      await this.registry.updateAgent(agentId, {
        host: `http://${publicIp}`,
        port: 3100,
        privateIp: readyInstance.privateIp,
        cloud: {
          provider,
          region,
          instanceId: instance.id,
        },
      });

      // Phase 1 complete
      this.completePhase(deployId, "provisioning");
      this.emitEvent(deployId, "log", {
        message: `VM ready: ${publicIp}`,
      });

      // =====================================================================
      // Phase 2-4: Bootstrap (installing → configuring → registering)
      // =====================================================================
      this.startPhase(deployId, "installing");

      // Get role config from registry
      const roleResult = await this.registry.getRole(request.roleId);
      if (!roleResult.success || !roleResult.data) {
        throw new Error(`Role not found: ${request.roleId}`);
      }

      const role = roleResult.data;

      // Build bootstrap config
      // Use private VPC IP for registry URL so agents connect over the private network.
      // Priority: REGISTRY_PRIVATE_URL env → auto-construct from control plane IP → REGISTRY_URL → fallback
      const registryPort = process.env.REGISTRY_PORT || "4001";
      const registryUrl = process.env.REGISTRY_PRIVATE_URL
        || (this.controlPlaneIp && this.controlPlaneIp !== "127.0.0.1"
          ? `http://${this.controlPlaneIp}:${registryPort}`
          : process.env.REGISTRY_URL || "http://localhost:4001");
      const hivemiSecret = process.env.HIVEMI_SECRET || "hivemi-dev-secret";

      const bootstrapConfig = {
        host: publicIp,
        sshPort: 22,
        sshPrivateKey: cloudConfig.sshPrivateKey!,
        sshUser: "root",
        agent: {
          agentId,
          agentName: request.name,
          roleId: request.roleId,
          teamId: request.teamId,
          model: request.model,
          daemonPort: 3100,
        },
        role: {
          soulMd: role.systemPrompt || `# ${role.name}\n\nYou are a ${role.name} agent.`,
          agentsMd: "# Agent Rules\n\nFollow standard HiveMI agent protocols.",
          toolsMd: "# Tools\n\nStandard HiveMI tools available.",
          configJson: JSON.stringify({
            model: request.model,
            maxTokens: 4096,
            temperature: 0.7,
          }),
        },
        secrets: [
          {
            ref: process.env.HIVEMI_SECRET_REF || "HIVEMI_SECRET",
            target: "env:HIVEMI_SECRET",
          },
        ],
        secretProvider: {
          name: "env",
          getSecret: async (ref: string) => {
            // Simple env-based secrets for now
            if (ref === "HIVEMI_SECRET") return hivemiSecret;
            return process.env[ref] || "";
          },
          resolveAll: async (mappings: Array<{ ref: string; target: string }>) => {
            const result = new Map<string, string>();
            for (const m of mappings) {
              const envVar = m.target.startsWith("env:") ? m.target.slice(4) : m.target;
              if (m.ref === "HIVEMI_SECRET") result.set(envVar, hivemiSecret);
              else result.set(envVar, process.env[m.ref] || "");
            }
            return result;
          },
        },
        registryUrl,
        hivemiSecret,
      };

      // Run bootstrapper with phase callbacks
      const bootstrapResult = await this.bootstrapper.bootstrap(bootstrapConfig, {
        skipCloudInit: false,
        onPhaseUpdate: (phases: any[]) => {
          // Map bootstrapper phases to deploy phases
          this.updateBootstrapPhases(deployId, phases);
        },
      });

      if (bootstrapResult.status === "failed") {
        throw new Error(
          `Bootstrap failed at phase "${bootstrapResult.failedPhase}": ${bootstrapResult.error}`,
        );
      }

      // =====================================================================
      // All phases complete — deploy is ready
      // =====================================================================
      this.completePhase(deployId, "registering");
      await this.updateDeployStatus(deployId, "ready");

      // Update agent status
      await this.registry.updateAgent(agentId, { status: "idle" });
      await this.registry.updateDeploy(deployId, {
        status: "ready",
        agentId,
        completedAt: new Date(),
      });

      this.emitEvent(deployId, "complete", {
        message: `Deploy completed successfully for ${request.name}`,
        agentId,
        instanceId,
      });

      logger.info({ deployId, agentId, instanceId }, "Deploy completed successfully");
    } catch (err) {
      const error = err as Error;
      logger.error({ deployId, agentId, error: error.message }, "Deploy failed");

      // Mark current running phase as failed
      const state = this.activeDeploys.get(deployId);
      if (state) {
        const runningPhase = state.phases.find((p) => p.status === "active");
        if (runningPhase) {
          this.failPhase(deployId, runningPhase.name, error.message);
        }
      }

      // Update registry
      await this.updateDeployStatus(deployId, "failed", error.message);
      await this.registry.updateDeploy(deployId, {
        status: "failed",
        error: error.message,
      }).catch(() => {});

      // Update agent status
      await this.registry.updateAgent(agentId, { status: "error" }).catch(() => {});

      this.emitEvent(deployId, "error", {
        message: error.message,
        phase: state?.phases.find((p) => p.status === "failed")?.name,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Undeploy — Destroy VM and clean up
  //
  // Full destruction flow:
  // 1. Check if agent is working — handle graceful shutdown option
  // 2. Destroy VM via provisioner
  // 3. Remove VM from firewall
  // 4. Requeue tasks locked by this agent
  // 5. Update deploy status to destroyed (keep in DB for history)
  // 6. Update agent status to destroyed (keep in DB for history)
  // -------------------------------------------------------------------------

  async undeploy(deployId: string, options?: { force?: boolean }): Promise<void> {
    const deployResult = await this.registry.getDeploy(deployId);
    if (!deployResult.success || !deployResult.data) {
      throw new Error("Deploy not found");
    }

    const deploy = deployResult.data;

    // Check if already destroyed
    if (deploy.status === "destroyed") {
      logger.info({ deployId }, "Deploy already destroyed");
      return;
    }

    // Check agent status for graceful shutdown
    if (deploy.agentId && !options?.force) {
      const agentStatus = await this.getAgentStatus(deploy.agentId);
      if (agentStatus === "working") {
        throw new UndeployBlockedError(
          "Agent is currently working on a task. Use force=true to destroy immediately, or wait for the task to complete.",
          deploy.agentId,
          deployId,
        );
      }
    }

    // Destroy VM if it exists
    if (deploy.instanceId) {
      try {
        await this.provisioner.destroyInstance(deploy.instanceId);
        logger.info({ deployId, instanceId: deploy.instanceId }, "VM destroyed");
      } catch (err) {
        // VM might already be gone (404) — log and continue
        logger.warn({ deployId, error: (err as Error).message }, "Failed to destroy VM (may already be gone)");
      }

      // Remove from firewall
      try {
        const cloudConfig = await this.registry.getCloudConfig();
        if (cloudConfig) {
          const firewallId = await this.provisioner.ensureFirewall("hivemi-agents", []);
          await this.provisioner.removeInstanceFromFirewall(firewallId, deploy.instanceId);
          logger.info({ deployId, instanceId: deploy.instanceId }, "VM removed from firewall");
        }
      } catch (err) {
        logger.warn({ deployId, error: (err as Error).message }, "Failed to remove VM from firewall (non-critical)");
      }
    }

    // Requeue tasks locked by this agent
    if (deploy.agentId) {
      try {
        await this.registry.requeueLockedTasks(deploy.agentId);
        logger.info({ deployId, agentId: deploy.agentId }, "Locked tasks requeued");
      } catch (err) {
        logger.warn({ deployId, error: (err as Error).message }, "Failed to requeue locked tasks");
      }
    }

    // Update deploy status (keep in DB for history — never delete rows)
    await this.registry.updateDeploy(deployId, {
      status: "destroyed",
      completedAt: new Date(),
    });

    // Update agent status (keep in DB for history)
    if (deploy.agentId) {
      await this.registry.updateAgent(deploy.agentId, {
        status: "destroyed",
      }).catch(() => {});
    }

    // Remove from active deploys
    this.activeDeploys.delete(deployId);

    this.emitEvent(deployId, "status_change", {
      status: "destroyed",
      message: "Deploy destroyed successfully",
    });

    logger.info({ deployId }, "Undeploy completed");
  }

  /**
   * Get agent status from registry.
   * Returns status string or null if agent not found.
   */
  private async getAgentStatus(agentId: string): Promise<string | null> {
    try {
      const result = await this.registry.updateAgent(agentId, {});
      return result.data?.status || null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Redeploy — Destroy and recreate
  // Uses the same config (role, team, model) but generates new name and VM.
  // Immutable deploy: always destroy + deploy fresh.
  // -------------------------------------------------------------------------

  async redeploy(
    deployId: string,
    request: DeployRequest,
  ): Promise<{ deployId: string; agentId: string }> {
    // Force destroy (don't block on working tasks)
    await this.undeploy(deployId, { force: true });

    // Then start a new deploy
    return this.startDeploy(request);
  }

  // -------------------------------------------------------------------------
  // Retry — Retry a failed deploy from a specific phase
  // -------------------------------------------------------------------------

  async retryPhase(deployId: string, phaseName?: string): Promise<void> {
    const deployResult = await this.registry.getDeploy(deployId);
    if (!deployResult.success || !deployResult.data) {
      throw new Error("Deploy not found");
    }

    const deploy = deployResult.data;
    if (deploy.status !== "failed") {
      throw new Error(`Cannot retry deploy in status "${deploy.status}" — only failed deploys can be retried`);
    }

    // Find the failed phase to retry from
    const phases = deploy.phases as DeployPhase[];
    const failedPhase = phaseName
      ? phases.find((p) => p.name === phaseName)
      : phases.find((p) => p.status === "failed");

    if (!failedPhase) {
      throw new Error(phaseName
        ? `Phase "${phaseName}" not found or not in failed state`
        : "No failed phase found to retry");
    }

    // Reset failed phase and all subsequent phases
    const phaseOrder = ["provisioning", "installing", "configuring", "registering"];
    const failedIdx = phaseOrder.indexOf(failedPhase.name);

    if (failedIdx === -1) {
      throw new Error(`Unknown phase: "${failedPhase.name}"`);
    }

    const updatedPhases = phases.map((p) => {
      const idx = phaseOrder.indexOf(p.name);
      if (idx >= failedIdx) {
        return {
          name: p.name,
          status: idx === failedIdx ? "active" as const : "pending" as const,
          startedAt: idx === failedIdx ? new Date().toISOString() : null,
          completedAt: null,
          error: null,
        };
      }
      return p;
    });

    // Update deploy status in registry
    await this.registry.updateDeploy(deployId, {
      status: failedPhase.name as DeployStatus,
      error: undefined,
    });

    // Update each phase
    for (const phase of updatedPhases) {
      await this.registry.updateDeploy(deployId, { phase });
    }

    // Track in memory
    const state: DeployState = {
      id: deployId,
      agentId: deploy.agentId,
      agentName: deploy.agentName,
      instanceId: deploy.instanceId,
      status: failedPhase.name as DeployStatus,
      phases: updatedPhases,
      error: null,
      startedAt: deploy.startedAt,
    };
    this.activeDeploys.set(deployId, state);

    this.emitEvent(deployId, "status_change", {
      status: failedPhase.name,
      message: `Retrying from phase "${failedPhase.name}"`,
    });

    logger.info({ deployId, retryFrom: failedPhase.name }, "Deploy retry initiated");

    // Note: For now, retry just resets the phases and status.
    // A full re-execution of the deploy pipeline from the failed phase
    // would require refactoring runDeploySequence to accept a starting phase.
    // This is tracked for a future iteration.
  }

  // -------------------------------------------------------------------------
  // State Accessors
  // -------------------------------------------------------------------------

  getDeployState(deployId: string): DeployState | undefined {
    return this.activeDeploys.get(deployId);
  }

  getActiveDeploys(): DeployState[] {
    return Array.from(this.activeDeploys.values());
  }

  // -------------------------------------------------------------------------
  // Phase Tracking Helpers
  // -------------------------------------------------------------------------

  private startPhase(deployId: string, phaseName: string): void {
    const state = this.activeDeploys.get(deployId);
    if (!state) return;

    const phase = state.phases.find((p) => p.name === phaseName);
    if (phase) {
      phase.status = "active";
      phase.startedAt = new Date().toISOString();
    }

    state.status = phaseName as DeployStatus;

    this.registry.updateDeploy(deployId, {
      status: phaseName,
      phase: phase || undefined,
    }).catch(() => {});

    this.emitEvent(deployId, "phase_update", {
      phase: phaseName,
      status: "active",
    });
  }

  private completePhase(deployId: string, phaseName: string): void {
    const state = this.activeDeploys.get(deployId);
    if (!state) return;

    const phase = state.phases.find((p) => p.name === phaseName);
    if (phase) {
      phase.status = "completed";
      phase.completedAt = new Date().toISOString();
    }

    this.registry.updateDeploy(deployId, {
      phase: phase || undefined,
    }).catch(() => {});

    this.emitEvent(deployId, "phase_update", {
      phase: phaseName,
      status: "completed",
    });
  }

  private failPhase(deployId: string, phaseName: string, error: string): void {
    const state = this.activeDeploys.get(deployId);
    if (!state) return;

    const phase = state.phases.find((p) => p.name === phaseName);
    if (phase) {
      phase.status = "failed";
      phase.completedAt = new Date().toISOString();
      phase.error = error;
    }

    state.error = error;

    this.registry.updateDeploy(deployId, {
      phase: phase || undefined,
      error,
    }).catch(() => {});

    this.emitEvent(deployId, "phase_update", {
      phase: phaseName,
      status: "failed",
      error,
    });
  }

  private updateBootstrapPhases(deployId: string, bootstrapPhases: any[]): void {
    // Map bootstrapper phase names to deploy phase names
    const phaseMapping: Record<string, string> = {
      "cloud-init": "installing",
      "ssh-connect": "installing",
      "inject-secrets": "configuring",
      "configure-openclaw": "configuring",
      "copy-role-config": "configuring",
      "install-daemon": "configuring",
      "verify-install": "configuring",
      "wait-registration": "registering",
    };

    for (const bp of bootstrapPhases) {
      const deployPhaseName = phaseMapping[bp.name];
      if (!deployPhaseName) continue;

      if (bp.status === "running") {
        const state = this.activeDeploys.get(deployId);
        if (state) {
          const currentPhase = state.phases.find((p) => p.status === "active");
          if (currentPhase && currentPhase.name !== deployPhaseName) {
            // Previous phase completed, start new one
            this.completePhase(deployId, currentPhase.name);
            this.startPhase(deployId, deployPhaseName);
          } else if (!currentPhase) {
            this.startPhase(deployId, deployPhaseName);
          }
        }
      }

      if (bp.status === "failed") {
        this.failPhase(deployId, deployPhaseName, bp.error || "Unknown error");
      }
    }
  }

  private async updateDeployStatus(
    deployId: string,
    status: DeployStatus,
    error?: string,
  ): Promise<void> {
    const state = this.activeDeploys.get(deployId);
    if (state) {
      state.status = status;
      if (error) state.error = error;
    }

    this.emitEvent(deployId, "status_change", { status, error });
  }

  // -------------------------------------------------------------------------
  // Event Emission
  // -------------------------------------------------------------------------

  private emitEvent(
    deployId: string,
    type: DeployEvent["type"],
    data: Record<string, unknown>,
  ): void {
    const event: DeployEvent = {
      type,
      deployId,
      timestamp: new Date().toISOString(),
      data,
    };

    this.emit("deploy_event", event);
    this.emit(`deploy:${deployId}`, event);
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when undeploy is blocked because the agent is currently working.
 * Callers can catch this to prompt the user to force destroy or wait.
 */
export class UndeployBlockedError extends Error {
  readonly agentId: string;
  readonly deployId: string;

  constructor(message: string, agentId: string, deployId: string) {
    super(message);
    this.name = "UndeployBlockedError";
    this.agentId = agentId;
    this.deployId = deployId;
  }
}
