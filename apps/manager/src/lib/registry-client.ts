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
}

interface Task {
  id: string;
  title: string;
  status: string;
  teamId: string;
}

export class RegistryClient {
  private baseUrl: string;

  constructor(baseUrl: string = REGISTRY_URL) {
    this.baseUrl = baseUrl;
  }

  async getAgents(): Promise<ApiResponse<Agent[]>> {
    const res = await fetch(`${this.baseUrl}/api/agents`);
    return res.json() as Promise<ApiResponse<Agent[]>>;
  }

  async getAvailableAgent(teamId?: string): Promise<Agent | null> {
    const res = await fetch(`${this.baseUrl}/api/agents`);
    const data = await res.json() as ApiResponse<Agent[]>;
    if (!data.success || !data.data) return null;
    
    // Find an idle agent, optionally filtered by team
    const agents = data.data.filter((a) => 
      a.status === "idle" && (!teamId || a.teamId === teamId)
    );
    
    return agents[0] || null;
  }

  async createTask(task: { title: string; description?: string; priority?: string; teamId: string; input?: string }): Promise<ApiResponse<Task>> {
    const res = await fetch(`${this.baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
    return res.json() as Promise<ApiResponse<Task>>;
  }

  async updateAgentStatus(agentId: string, status: string, currentTaskId?: string | null): Promise<ApiResponse<Agent>> {
    const res = await fetch(`${this.baseUrl}/api/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, currentTaskId }),
    });
    return res.json() as Promise<ApiResponse<Agent>>;
  }

  async updateTaskStatus(taskId: string, status: string, output?: string, error?: string): Promise<ApiResponse<Task>> {
    const body: Record<string, unknown> = { status };
    if (status === "locked") body.startedAt = new Date();
    if (status === "completed" || status === "failed") body.completedAt = new Date();
    if (output) body.output = output;
    if (error) body.error = error;

    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<ApiResponse<Task>>;
  }

  async getRoles(): Promise<ApiResponse<unknown[]>> {
    const res = await fetch(`${this.baseUrl}/api/roles`);
    return res.json() as Promise<ApiResponse<unknown[]>>;
  }

  async getTeams(): Promise<ApiResponse<unknown[]>> {
    const res = await fetch(`${this.baseUrl}/api/teams`);
    return res.json() as Promise<ApiResponse<unknown[]>>;
  }
}

export const registryClient = new RegistryClient();
