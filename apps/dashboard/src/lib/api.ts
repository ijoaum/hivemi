// API calls go to same origin (Next.js API routes handle proxying)
const API_BASE_URL = "";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  
  const json = await res.json() as ApiResponse<T>;
  
  if (!json.success) {
    throw new Error(json.error || "API request failed");
  }
  
  return json.data as T;
}

// Agents
export interface Agent {
  id: string;
  name: string;
  roleId: string;
  teamId: string;
  status: "provisioning" | "idle" | "working" | "offline" | "unreachable" | "error" | "destroyed";
  model: string;
  host: string;
  port: number;
  currentTaskId: string | null;
  lastHeartbeat: string | null;
  createdAt: string;
  updatedAt: string;
  // Populated from JOIN
  role?: {
    id: string;
    name: string;
    slug: string;
    icon: string;
    color: string;
    description: string;
    capabilities: string[];
  } | null;
  team?: {
    id: string;
    name: string;
    emoji: string;
    color: string;
  } | null;
}

export const agentsApi = {
  list: () => fetchApi<Agent[]>("/api/agents"),
  get: (id: string) => fetchApi<Agent>(`/api/agents/${id}`),
  create: (data: Partial<Agent>) => fetchApi<Agent>("/api/agents", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<Agent>) => fetchApi<Agent>(`/api/agents/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<Agent>(`/api/agents/${id}`, {
    method: "DELETE",
  }),
};

// Roles
export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export const rolesApi = {
  list: () => fetchApi<Role[]>("/api/roles"),
  get: (id: string) => fetchApi<Role>(`/api/roles/${id}`),
  create: (data: Partial<Role>) => fetchApi<Role>("/api/roles", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<Role>) => fetchApi<Role>(`/api/roles/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<Role>(`/api/roles/${id}`, {
    method: "DELETE",
  }),
};

// Teams
export interface Team {
  id: string;
  name: string;
  emoji: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export const teamsApi = {
  list: () => fetchApi<Team[]>("/api/teams"),
  get: (id: string) => fetchApi<Team>(`/api/teams/${id}`),
  create: (data: Partial<Team>) => fetchApi<Team>("/api/teams", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<Team>) => fetchApi<Team>(`/api/teams/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<Team>(`/api/teams/${id}`, {
    method: "DELETE",
  }),
};

// Tasks
export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: "queued" | "locked" | "completed" | "failed" | "cancelling" | "cancelled";
  priority: "high" | "medium" | "low";
  agentId: string | null;
  teamId: string;
  input: string | null;
  output: string | null;
  error: string | null;
  estimatedMs: number | null;
  elapsedMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const tasksApi = {
  list: (params?: { status?: string; teamId?: string }) => {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    return fetchApi<Task[]>(`/api/tasks${query ? `?${query}` : ""}`);
  },
  get: (id: string) => fetchApi<Task>(`/api/tasks/${id}`),
  create: (data: Partial<Task>) => fetchApi<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  }),
  update: (id: string, data: Partial<Task>) => fetchApi<Task>(`/api/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }),
  retry: (id: string) => fetchApi<Task>(`/api/tasks/${id}/retry`, {
    method: "POST",
  }),
  cancel: (id: string) => fetchApi<Task>(`/api/tasks/${id}/cancel`, {
    method: "POST",
  }),
  delete: (id: string) => fetchApi<Task>(`/api/tasks/${id}`, {
    method: "DELETE",
  }),
};

// Logs
export interface LogEntry {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error" | "lifecycle";
  source: string;
  agentId: string | null;
  taskId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
}

export const logsApi = {
  list: (params?: { limit?: number; agentId?: string; level?: string; from?: string; to?: string }) => {
    const cleanParams: Record<string, string> = {};
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) cleanParams[k] = String(v);
      }
    }
    const query = new URLSearchParams(cleanParams).toString();
    return fetchApi<LogEntry[]>(`/api/logs${query ? `?${query}` : ""}`);
  },
};

// Status
export interface SystemStatus {
  agents: {
    total: number;
    online: number;
    working: number;
    idle: number;
    error: number;
  };
  roles: number;
  teams: number;
  timestamp: string;
}

export const statusApi = {
  get: () => fetchApi<SystemStatus>("/api/status"),
};

// Demands (create tasks via manager)
export const demandsApi = {
  create: (data: { title: string; description?: string; priority?: string; teamId: string; input?: string }) => 
    fetchApi<{ task: Task; assignedTo: { id: string; name: string } | null }>("/api/demands", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// Infra — Reconciliation & Costs
export interface ReconciliationIssue {
  type: "orphaned_vm" | "phantom_agent" | "ip_mismatch";
  severity: "warning" | "error";
  message: string;
  instanceId?: string;
  instanceName?: string;
  agentId?: string;
  agentName?: string;
}

export interface ReconciliationReport {
  issues: ReconciliationIssue[];
  status: "clean" | "warning" | "critical";
  timestamp: string;
  provider: string;
  stats: {
    totalVMs: number;
    healthy: number;
    orphaned: number;
    phantom: number;
    ipMismatches: number;
  };
}

export interface InstanceCostBreakdown {
  name: string;
  size: "small" | "medium" | "large";
  monthlyCostUsd: number;
  daysRunning: number;
  accumulatedCostUsd: number;
}

export interface CostReport {
  monthly: number;
  projected: number;
  accumulated: number;
  breakdown: InstanceCostBreakdown[];
  provider: string;
  generatedAt: string;
}

export const infraApi = {
  reconcile: () => fetchApi<ReconciliationReport>("/api/infra/reconcile"),
  costs: () => fetchApi<CostReport>("/api/infra/costs"),
  destroyOrphan: (instanceId: string) => fetchApi<{ message: string }>(`/api/infra/reconcile/orphan/${instanceId}`, {
    method: "DELETE",
  }),
};
