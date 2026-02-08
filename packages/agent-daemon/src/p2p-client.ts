// =============================================================================
// P2P Client — Direct Agent-to-Agent Communication (Issue #56)
//
// Enables an agent to send messages directly to other agents, bypassing
// the task queue. The flow:
//
// 1. Discover target agent endpoint via registry:
//    GET /api/agents/:id/endpoint → { host, port, privateIp }
//
// 2. Send message directly to target daemon:
//    POST http://<host>:<port>/message → { accepted, response? }
//
// 3. On failure, retry with exponential backoff (1s, 3s, 9s).
//
// Discovery results are cached to avoid repeated registry lookups.
// Cache entries expire after 60s or on connection failure.
// =============================================================================

import { randomUUID } from "node:crypto";
import type { DaemonConfig, DaemonLogger } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type P2PMessageType = "request" | "response" | "delegate" | "ping" | "pong";

export interface P2PMessage {
  id: string;
  type: P2PMessageType;
  from: string;
  to: string;
  payload: unknown;
  timestamp: string;
  correlationId?: string;
  ttlMs?: number;
}

export interface P2PMessageAck {
  accepted: boolean;
  error?: string;
  response?: P2PMessage;
}

export interface AgentEndpoint {
  id: string;
  name: string;
  host: string;
  port: number;
  status: string;
  privateIp?: string | null;
}

export interface P2PRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
}

export interface P2PSendOptions {
  /** Timeout for the HTTP request in ms (default: 10000) */
  timeoutMs?: number;
  /** Custom retry config (overrides defaults) */
  retry?: Partial<P2PRetryConfig>;
  /** Correlation ID for request-response linking */
  correlationId?: string;
  /** TTL in ms — receiver discards if expired */
  ttlMs?: number;
}

// ---------------------------------------------------------------------------
// Discovery cache entry
// ---------------------------------------------------------------------------

interface CacheEntry {
  endpoint: AgentEndpoint;
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// P2P Client
// ---------------------------------------------------------------------------

export class P2PClient {
  private readonly config: DaemonConfig;
  private readonly logger: DaemonLogger;

  /** Endpoint cache: agentId → { endpoint, cachedAt } */
  private readonly cache = new Map<string, CacheEntry>();

  /** Cache TTL in ms (default: 60s) */
  private readonly cacheTtlMs: number;

  /** Default retry config: 3 retries, backoff 1s → 3s → 9s */
  private readonly defaultRetry: P2PRetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    multiplier: 3,
    maxDelayMs: 30000,
  };

  constructor(
    config: DaemonConfig,
    logger: DaemonLogger,
    options?: { cacheTtlMs?: number },
  ) {
    this.config = config;
    this.logger = logger;
    this.cacheTtlMs = options?.cacheTtlMs ?? 60_000;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Send a P2P message to another agent.
   *
   * 1. Resolves the target agent's endpoint via registry (cached).
   * 2. Sends HTTP POST to the agent's daemon.
   * 3. Retries with exponential backoff on failure.
   *
   * Returns the acknowledgment from the target agent.
   * Throws on unrecoverable failure (all retries exhausted).
   */
  async send(
    targetAgentId: string,
    type: P2PMessageType,
    payload: unknown,
    options: P2PSendOptions = {},
  ): Promise<P2PMessageAck> {
    // Build the message
    const message: P2PMessage = {
      id: randomUUID(),
      type,
      from: this.config.agentId,
      to: targetAgentId,
      payload,
      timestamp: new Date().toISOString(),
      ...(options.correlationId ? { correlationId: options.correlationId } : {}),
      ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
    };

    // Resolve endpoint
    const endpoint = await this.discover(targetAgentId);

    // Send with retry
    const retryConfig = { ...this.defaultRetry, ...(options.retry ?? {}) };
    return this.sendWithRetry(endpoint, message, retryConfig, options.timeoutMs ?? 10_000);
  }

  /**
   * Send a request message and wait for the response.
   * Convenience wrapper that handles correlation IDs.
   */
  async request(
    targetAgentId: string,
    payload: { action: string; content: string; taskId?: string; metadata?: Record<string, unknown> },
    options: P2PSendOptions = {},
  ): Promise<P2PMessageAck> {
    return this.send(targetAgentId, "request", payload, options);
  }

  /**
   * Send a delegate message (fire-and-forget).
   */
  async delegate(
    targetAgentId: string,
    payload: { action: string; content: string; priority?: string; taskId?: string },
    options: P2PSendOptions = {},
  ): Promise<P2PMessageAck> {
    return this.send(targetAgentId, "delegate", payload, options);
  }

  /**
   * Ping another agent directly (bypasses registry heartbeat).
   * Returns the pong response if the agent is alive.
   */
  async ping(
    targetAgentId: string,
    options: P2PSendOptions = {},
  ): Promise<P2PMessageAck> {
    return this.send(targetAgentId, "ping", { status: "idle" }, {
      ...options,
      // Pings should be fast
      timeoutMs: options.timeoutMs ?? 5000,
      retry: { maxRetries: 1, initialDelayMs: 500, multiplier: 2, maxDelayMs: 2000, ...options.retry },
    });
  }

  /**
   * Discover an agent's endpoint via the registry.
   * Results are cached for cacheTtlMs.
   */
  async discover(agentId: string): Promise<AgentEndpoint> {
    // Check cache
    const cached = this.cache.get(agentId);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.endpoint;
    }

    // Fetch from registry
    const url = `${this.config.registryUrl.replace(/\/$/, "")}/api/agents/${agentId}/endpoint`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${this.config.hivemiSecret}`,
        "X-Agent-Id": this.config.agentId,
      },
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new P2PError(`Agent ${agentId} not found in registry`, "AGENT_NOT_FOUND");
      }
      const text = await res.text();
      throw new P2PError(`Discovery failed: ${res.status} ${text}`, "DISCOVERY_FAILED");
    }

    const json = (await res.json()) as { success: boolean; data?: AgentEndpoint };
    if (!json.success || !json.data) {
      throw new P2PError("Invalid discovery response", "DISCOVERY_FAILED");
    }

    // Cache the result
    this.cache.set(agentId, { endpoint: json.data, cachedAt: Date.now() });

    this.logger.debug(`Discovered agent ${agentId}: ${json.data.host}:${json.data.port}`);
    return json.data;
  }

  /**
   * Clear the discovery cache (e.g., on connection failure).
   */
  clearCache(agentId?: string): void {
    if (agentId) {
      this.cache.delete(agentId);
    } else {
      this.cache.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /**
   * Send a message to an agent's daemon with retry and exponential backoff.
   */
  private async sendWithRetry(
    endpoint: AgentEndpoint,
    message: P2PMessage,
    retry: P2PRetryConfig,
    timeoutMs: number,
  ): Promise<P2PMessageAck> {
    // Prefer privateIp if available (same VPC)
    const host = endpoint.privateIp || endpoint.host;
    const url = `http://${host}:${endpoint.port}/message`;

    let lastError: Error | null = null;
    let delay = retry.initialDelayMs;

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      if (attempt > 0) {
        this.logger.debug(`P2P retry ${attempt}/${retry.maxRetries} to ${endpoint.name} (delay: ${delay}ms)`);
        await sleep(delay);
        delay = Math.min(delay * retry.multiplier, retry.maxDelayMs);
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Id": this.config.agentId,
          },
          body: JSON.stringify(message),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) {
          const ack = (await res.json()) as P2PMessageAck;
          return ack;
        }

        // Non-retryable errors
        if (res.status === 400 || res.status === 404) {
          const text = await res.text();
          throw new P2PError(
            `Agent ${endpoint.name} rejected message: ${res.status} ${text}`,
            res.status === 404 ? "AGENT_NOT_FOUND" : "MESSAGE_REJECTED",
          );
        }

        // Server errors — retryable
        lastError = new Error(`HTTP ${res.status}`);
      } catch (err) {
        if (err instanceof P2PError) throw err;

        lastError = err instanceof Error ? err : new Error(String(err));

        // Abort errors = timeout
        if (lastError.name === "AbortError") {
          lastError = new P2PError(`Request timed out after ${timeoutMs}ms`, "TIMEOUT");
        }
      }
    }

    // All retries exhausted — clear cache for this agent (endpoint may have changed)
    this.clearCache(message.to);

    throw new P2PError(
      `Failed to send message to ${endpoint.name} after ${retry.maxRetries + 1} attempts: ${lastError?.message}`,
      "DELIVERY_FAILED",
    );
  }
}

// ---------------------------------------------------------------------------
// P2P Error
// ---------------------------------------------------------------------------

export type P2PErrorCode =
  | "AGENT_NOT_FOUND"
  | "DISCOVERY_FAILED"
  | "MESSAGE_REJECTED"
  | "TIMEOUT"
  | "DELIVERY_FAILED";

export class P2PError extends Error {
  readonly code: P2PErrorCode;

  constructor(message: string, code: P2PErrorCode) {
    super(message);
    this.name = "P2PError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
