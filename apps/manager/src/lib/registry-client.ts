// =============================================================================
// Enhanced Registry Client
// HTTP client for Manager → Registry communication
// Supports all CRUD + deploy + task operations
// =============================================================================

import { logger } from "./logger.js";

const REGISTRY_URL = process.env.REGISTRY_URL || "http://localhost:4001";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface Agent {
  id: string;
  name: string;
  status: string;
  teamId: string;
  roleId: string;
  model: string;
  host: string;
  port: number;
  currentTaskId: string | null;
  deployId?: string | null;
  cloud?: { provider: string; region: string; instanceId: string } | null;
  privateIp?: string | null;
}

interface Task {
  id: string;
  title: string;
  status: string;
  teamId: string;
  roleTarget?: string | null;
  parentTaskId?: string | null;
  priority?: string;
}

interface Role {
  id: string;
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
}

interface Deploy {
  id: string;
  agentId: string | null;
  agentName: string;
  cloudProvider: string;
  region: string;
  instanceSize: string;
  instanceId: string | null;
  status: string;
  phases: Array<{
    name: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }>;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export class RegistryClient {
  private baseUrl: string;

  constructor(baseUrl: string = REGISTRY_URL) {
    this.baseUrl = baseUrl;
  }

  // =========================================================================
  // Internal HTTP helpers
  // =========================================================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, options);
      return (await res.json()) as ApiResponse<T>;
    } catch (err) {
      logger.error({ method, path, error: (err as Error).message }, "Registry request failed");
      return { success: false, error: (err as Error).message };
    }
  }

  // =========================================================================
  // AGENTS
  // =========================================================================

  async getAgents(): Promise<ApiResponse<Agent[]>> {
    return this.request<Agent[]>("GET", "/api/agents");
  }

  async getAgent(id: string): Promise<ApiResponse<Agent>> {
    return this.request<Agent>("GET", `/api/agents/${id}`);
  }

  async createAgent(data: {
    name: string;
    roleId: string;
    teamId: string;
    model: string;
    host: string;
    port: number;
  }): Promise<ApiResponse<Agent>> {
    return this.request<Agent>("POST", "/api/agents", data);
  }

  async updateAgent(id: string, data: Record<string, unknown>): Promise<ApiResponse<Agent>> {
    return this.request<Agent>("PUT", `/api/agents/${id}`, data);
  }

  async deleteAgent(id: string): Promise<ApiResponse<Agent>> {
    return this.request<Agent>("DELETE", `/api/agents/${id}`);
  }

  async updateAgentStatus(
    agentId: string,
    status: string,
    currentTaskId?: string | null,
  ): Promise<ApiResponse<Agent>> {
    return this.updateAgent(agentId, { status, currentTaskId });
  }

  async getAvailableAgent(teamId?: string): Promise<Agent | null> {
    const res = await this.getAgents();
    if (!res.success || !res.data) return null;

    const agents = res.data.filter(
      (a) => a.status === "idle" && (!teamId || a.teamId === teamId),
    );

    return agents[0] || null;
  }

  // =========================================================================
  // ROLES
  // =========================================================================

  async getRoles(): Promise<ApiResponse<Role[]>> {
    return this.request<Role[]>("GET", "/api/roles");
  }

  async getRole(id: string): Promise<ApiResponse<Role>> {
    return this.request<Role>("GET", `/api/roles/${id}`);
  }

  // =========================================================================
  // TEAMS
  // =========================================================================

  async getTeams(): Promise<ApiResponse<unknown[]>> {
    return this.request<unknown[]>("GET", "/api/teams");
  }

  // =========================================================================
  // TASKS
  // =========================================================================

  async getTasks(filters?: {
    status?: string;
    teamId?: string;
    roleTarget?: string;
    limit?: number;
  }): Promise<ApiResponse<Task[]>> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.teamId) params.set("teamId", filters.teamId);
    if (filters?.roleTarget) params.set("roleTarget", filters.roleTarget);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<Task[]>("GET", `/api/tasks${qs}`);
  }

  async getTask(id: string): Promise<ApiResponse<Task>> {
    return this.request<Task>("GET", `/api/tasks/${id}`);
  }

  async createTask(data: {
    title: string;
    description?: string;
    priority?: string;
    teamId: string;
    roleTarget?: string;
    parentTaskId?: string;
    input?: string;
  }): Promise<ApiResponse<Task>> {
    return this.request<Task>("POST", "/api/tasks", data);
  }

  async updateTask(id: string, data: Record<string, unknown>): Promise<ApiResponse<Task>> {
    return this.request<Task>("PUT", `/api/tasks/${id}`, data);
  }

  async updateTaskStatus(
    taskId: string,
    status: string,
    output?: string,
    error?: string,
  ): Promise<ApiResponse<Task>> {
    const body: Record<string, unknown> = { status };
    if (status === "locked") body.startedAt = new Date();
    if (status === "completed" || status === "failed") body.completedAt = new Date();
    if (output) body.output = output;
    if (error) body.error = error;
    return this.updateTask(taskId, body);
  }

  // =========================================================================
  // DEPLOYS
  // =========================================================================

  async getDeploys(filters?: {
    status?: string;
    limit?: number;
  }): Promise<ApiResponse<Deploy[]>> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.limit) params.set("limit", String(filters.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return this.request<Deploy[]>("GET", `/api/deploys${qs}`);
  }

  async getDeploy(id: string): Promise<ApiResponse<Deploy>> {
    return this.request<Deploy>("GET", `/api/deploys/${id}`);
  }

  async createDeploy(data: {
    agentName: string;
    cloudProvider: string;
    region: string;
    instanceSize: string;
  }): Promise<ApiResponse<Deploy>> {
    return this.request<Deploy>("POST", "/api/deploys", data);
  }

  async updateDeploy(
    id: string,
    data: {
      status?: string;
      instanceId?: string;
      agentId?: string;
      error?: string;
      phase?: {
        name: string;
        status: string;
        startedAt: string | null;
        completedAt: string | null;
        error: string | null;
      };
      completedAt?: Date;
    },
  ): Promise<ApiResponse<Deploy>> {
    return this.request<Deploy>("PUT", `/api/deploys/${id}`, data);
  }

  // =========================================================================
  // CLOUD CONFIG (via settings proxy)
  // =========================================================================

  async getCloudConfig(): Promise<{
    provider: string;
    region: string;
    instanceSize: string;
    apiToken: string | null;
    sshKeyId: string | null;
    sshPublicKey: string | null;
    sshPrivateKey: string | null;
  } | null> {
    // The Manager needs the full config with secrets.
    // This endpoint is internal-only (Registry → Manager, never exposed to clients).
    const result = await this.request<any>("GET", "/api/settings/cloud/internal");

    if (!result.success || !result.data) {
      // Fallback: try the public endpoint (won't have secrets)
      const publicResult = await this.request<any>("GET", "/api/settings/cloud");
      if (!publicResult.success || !publicResult.data) return null;

      return {
        provider: publicResult.data.provider,
        region: publicResult.data.region,
        instanceSize: publicResult.data.instanceSize,
        apiToken: null,
        sshKeyId: publicResult.data.sshKeyId || null,
        sshPublicKey: null,
        sshPrivateKey: null,
      };
    }

    return result.data;
  }
}

export const registryClient = new RegistryClient();
