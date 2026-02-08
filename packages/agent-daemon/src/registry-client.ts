// =============================================================================
// Registry Client
// HTTP client for the HiveMI Registry API.
// Handles registration, heartbeat, task polling, telemetry, and log shipping.
// =============================================================================

import { networkInterfaces } from "node:os";
import type {
  DaemonConfig,
  DaemonLogger,
  DaemonTask,
  IRegistryClient,
  LogEntry,
  TaskResult,
  TelemetrySnapshot,
} from "./types.js";

/**
 * Detect the private VPC IP address.
 * Looks for a 10.x.x.x, 172.16-31.x.x, or 192.168.x.x IPv4 address
 * on a non-loopback interface. Returns null if none found.
 */
function detectPrivateIp(): string | null {
  const ifaces = networkInterfaces();
  for (const [, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      // Match RFC1918 private ranges
      if (
        addr.address.startsWith("10.") ||
        addr.address.startsWith("172.16.") || addr.address.startsWith("172.17.") ||
        addr.address.startsWith("172.18.") || addr.address.startsWith("172.19.") ||
        addr.address.startsWith("172.2") || addr.address.startsWith("172.30.") ||
        addr.address.startsWith("172.31.") ||
        addr.address.startsWith("192.168.")
      ) {
        return addr.address;
      }
    }
  }
  return null;
}

export class RegistryClient implements IRegistryClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly roleId: string;
  private readonly secret: string;
  private readonly config: DaemonConfig;
  private readonly logger: DaemonLogger;

  constructor(config: DaemonConfig, logger: DaemonLogger) {
    this.baseUrl = config.registryUrl.replace(/\/$/, "");
    this.agentId = config.agentId;
    this.roleId = config.roleId;
    this.secret = config.hivemiSecret;
    this.config = config;
    this.logger = logger;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.secret}`,
      "X-Agent-Id": this.agentId,
    };
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    return res;
  }

  // -------------------------------------------------------------------------
  // Registration — POST /api/agents (upsert)
  // Single POST call: creates if new, updates if ID already exists.
  // -------------------------------------------------------------------------

  async register(): Promise<void> {
    this.logger.info("Registering with registry", { agentId: this.agentId });

    // Detect private VPC IP for internal communication
    const privateIp = detectPrivateIp();
    if (privateIp) {
      this.logger.info(`Detected private IP: ${privateIp}`);
    } else {
      this.logger.warn("No private IP detected — agent will use public IP for communication");
    }

    const res = await this.request("POST", "/api/agents", {
      id: this.agentId,
      name: this.config.agentName,
      roleId: this.config.roleId,
      teamId: this.config.teamId,
      model: this.config.model,
      host: privateIp || "0.0.0.0",
      port: this.config.daemonPort,
      ...(privateIp ? { privateIp } : {}),
    });

    if (res.ok) {
      const status = res.status === 201 ? "created" : "updated";
      this.logger.info(`Registered (${status} agent)`);
      return;
    }

    const text = await res.text();
    throw new Error(`Registration failed: ${res.status} ${text}`);
  }

  // -------------------------------------------------------------------------
  // Heartbeat — POST /api/agents/:id/heartbeat
  // Sends status, currentTaskId, and timestamp.
  // Returns true if acknowledged, false if 404 (agent removed — need re-register).
  // -------------------------------------------------------------------------

  async heartbeat(
    status: "idle" | "working" | "error" = "idle",
    currentTaskId: string | null = null,
  ): Promise<boolean> {
    const res = await this.request("POST", `/api/agents/${this.agentId}/heartbeat`, {
      status,
      currentTaskId,
      timestamp: new Date().toISOString(),
    });

    if (res.ok) {
      return true;
    }

    if (res.status === 404) {
      // Agent was removed from registry — need to re-register
      this.logger.warn("Heartbeat returned 404 — agent not found in registry, will re-register");
      return false;
    }

    const text = await res.text();
    this.logger.warn(`Heartbeat failed: ${res.status}`, { body: text });
    return true; // Don't trigger re-register on server errors
  }

  // -------------------------------------------------------------------------
  // Status update — PUT /api/agents/:id
  // -------------------------------------------------------------------------

  async updateStatus(status: string): Promise<void> {
    const res = await this.request("PUT", `/api/agents/${this.agentId}`, {
      status,
      updatedAt: new Date().toISOString(),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Status update failed: ${res.status}`, { body: text });
    }
  }

  // -------------------------------------------------------------------------
  // Task polling — GET /api/tasks/next?role=<roleId>
  // The registry is expected to implement this endpoint:
  //   SELECT * FROM tasks WHERE status='queued' AND (role_target=<roleId> OR role_target IS NULL)
  //   ORDER BY priority DESC, created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
  // If not available yet, falls back to GET /api/tasks?status=queued
  // -------------------------------------------------------------------------

  async pollTask(): Promise<DaemonTask | null> {
    // Try the optimized /tasks/next endpoint first
    const nextRes = await this.request(
      "GET",
      `/api/tasks/next?role=${encodeURIComponent(this.roleId)}&agentId=${encodeURIComponent(this.agentId)}`,
    );

    if (nextRes.ok) {
      const json = await nextRes.json() as { success: boolean; data?: DaemonTask };
      if (json.success && json.data) {
        return json.data;
      }
      return null;
    }

    // Fallback: GET /api/tasks?status=queued and pick first matching
    if (nextRes.status === 404) {
      this.logger.debug("Task next endpoint not available, using fallback");
      const fallbackRes = await this.request("GET", "/api/tasks?status=queued");
      if (!fallbackRes.ok) return null;

      const json = await fallbackRes.json() as { success: boolean; data?: DaemonTask[] };
      if (!json.success || !json.data || json.data.length === 0) return null;

      // Find first task matching our role (or no role target)
      const task = json.data.find(
        (t) => t.roleTarget === null || t.roleTarget === this.roleId,
      );

      if (task) {
        // Lock it by updating status to locked
        const lockRes = await this.request("PUT", `/api/tasks/${task.id}`, {
          status: "locked",
          lockedBy: this.agentId,
          lockedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
        });
        if (!lockRes.ok) return null;
        return task;
      }

      return null;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Report task result — PUT /api/tasks/:id/complete
  // Uses the new structured completion endpoint from Issue #55.
  // Falls back to PUT /api/tasks/:id if the complete endpoint is not available.
  // -------------------------------------------------------------------------

  async reportTaskResult(taskId: string, result: TaskResult): Promise<void> {
    // Try the structured completion endpoint first (Issue #55)
    const completeBody: Record<string, unknown> = {
      status: result.status,
      output: result.output,
      duration: result.elapsedMs,
    };

    if (result.error) {
      completeBody.error = result.error;
    }

    if (result.artifacts.length > 0) {
      completeBody.artifacts = result.artifacts;
    }

    const completeRes = await this.request("PUT", `/api/tasks/${taskId}/complete`, completeBody);

    if (completeRes.ok) return;

    // Fallback to old PUT /api/tasks/:id endpoint
    if (completeRes.status === 404) {
      const body: Record<string, unknown> = {
        status: result.status,
        output: result.output,
        elapsedMs: result.elapsedMs,
        completedAt: new Date().toISOString(),
        agentId: this.agentId,
      };

      if (result.error) {
        body.error = result.error;
      }

      if (result.artifacts.length > 0) {
        body.artifacts = result.artifacts;
      }

      const res = await this.request("PUT", `/api/tasks/${taskId}`, body);
      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Failed to report task result: ${res.status}`, {
          taskId,
          body: text,
        });
      }
      return;
    }

    const text = await completeRes.text();
    this.logger.error(`Failed to report task result: ${completeRes.status}`, {
      taskId,
      body: text,
    });
  }

  // -------------------------------------------------------------------------
  // Telemetry — POST /api/agents/:id/telemetry
  // Falls back to PUT /api/agents/:id with telemetry in metadata
  // -------------------------------------------------------------------------

  async sendTelemetry(snapshot: TelemetrySnapshot): Promise<void> {
    // Try dedicated telemetry endpoint
    const res = await this.request(
      "POST",
      `/api/agents/${this.agentId}/telemetry`,
      snapshot,
    );

    if (res.ok) return;

    // Fallback: update agent with basic info
    if (res.status === 404) {
      await this.request("PUT", `/api/agents/${this.agentId}`, {
        lastHeartbeat: new Date().toISOString(),
        openclawVersion: snapshot.daemon.openclawStatus,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Log shipping — POST /api/logs (batch)
  // -------------------------------------------------------------------------

  async sendLogs(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Send logs one by one (registry expects single log entries)
    // In a production system, we'd batch this
    for (const entry of entries) {
      try {
        await this.request("POST", "/api/logs", entry);
      } catch (_err) {
        // Silently drop failed log entries to avoid cascading failures
        this.logger.debug("Failed to ship log entry");
      }
    }
  }

  // -------------------------------------------------------------------------
  // Offline — PUT /api/agents/:id with status=offline
  // -------------------------------------------------------------------------

  async setOffline(): Promise<void> {
    this.logger.info("Setting agent status to offline");
    await this.updateStatus("offline");
  }
}
