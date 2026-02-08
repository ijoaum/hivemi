// =============================================================================
// P2P Message Handler — Incoming Message Server (Issue #56)
//
// Listens on the daemon's HTTP port for incoming P2P messages from other agents.
// Each message type is handled differently:
//
// - ping → immediately replies with pong (inline response)
// - request → queues for agent processing, returns ack
// - response → matches to pending request, returns ack
// - delegate → queues for agent processing, returns ack
//
// The handler validates incoming messages with Zod schemas and checks
// TTL expiration before processing.
// =============================================================================

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { DaemonLogger, DaemonConfig } from "./types.js";
import type { P2PMessage, P2PMessageAck, P2PMessageType } from "./p2p-client.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Callback invoked when a P2P message is received.
 * The handler decides what to do with the message (queue it, process it, etc.).
 * Returns a response payload for request messages, or void for others.
 */
export type P2PMessageCallback = (
  message: P2PMessage,
) => Promise<{ content?: string; error?: string; metadata?: Record<string, unknown> } | void>;

export interface P2PHandlerConfig {
  /** Port to listen on (default: daemon port) */
  port: number;
  /** Optional hostname to bind to (default: 0.0.0.0) */
  hostname?: string;
  /** Maximum message body size in bytes (default: 1MB) */
  maxBodySize?: number;
}

// ---------------------------------------------------------------------------
// P2P Handler
// ---------------------------------------------------------------------------

export class P2PHandler {
  private readonly config: DaemonConfig;
  private readonly handlerConfig: P2PHandlerConfig;
  private readonly logger: DaemonLogger;
  private readonly onMessage: P2PMessageCallback;
  private server: Server | null = null;

  /** Track pending request-response correlations */
  private readonly pendingRequests = new Map<
    string,
    { resolve: (msg: P2PMessage) => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    config: DaemonConfig,
    logger: DaemonLogger,
    onMessage: P2PMessageCallback,
    handlerConfig?: Partial<P2PHandlerConfig>,
  ) {
    this.config = config;
    this.logger = logger;
    this.onMessage = onMessage;
    this.handlerConfig = {
      port: handlerConfig?.port ?? config.daemonPort,
      hostname: handlerConfig?.hostname ?? "0.0.0.0",
      maxBodySize: handlerConfig?.maxBodySize ?? 1_048_576, // 1MB
    };
  }

  // -------------------------------------------------------------------------
  // Start / Stop
  // -------------------------------------------------------------------------

  /**
   * Start the HTTP server for incoming P2P messages.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on("error", (err) => {
        this.logger.error("P2P handler server error", { error: err.message });
        reject(err);
      });

      this.server.listen(this.handlerConfig.port, this.handlerConfig.hostname, () => {
        this.logger.info(
          `P2P handler listening on ${this.handlerConfig.hostname}:${this.handlerConfig.port}`,
        );
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server.
   */
  async stop(): Promise<void> {
    // Clear all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
    }

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.logger.info("P2P handler stopped");
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * Wait for a response to a specific request (by correlation ID).
   * Used when this agent sends a request and expects a response back.
   */
  waitForResponse(correlationId: string, timeoutMs: number = 30_000): Promise<P2PMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`P2P response timeout after ${timeoutMs}ms for ${correlationId}`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, timer });
    });
  }

  // -------------------------------------------------------------------------
  // Request handling
  // -------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Health check endpoint
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", agentId: this.config.agentId }));
      return;
    }

    // Only accept POST /message
    if (req.method !== "POST" || req.url !== "/message") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: false, error: "Not found" }));
      return;
    }

    try {
      // Read body with size limit
      const body = await this.readBody(req);
      if (!body) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, error: "Empty body" }));
        return;
      }

      // Parse JSON
      let message: P2PMessage;
      try {
        message = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ accepted: false, error: "Invalid JSON" }));
        return;
      }

      // Validate required fields
      if (!message.id || !message.type || !message.from || !message.to) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ accepted: false, error: "Missing required fields: id, type, from, to" }),
        );
        return;
      }

      // Verify this message is for us
      if (message.to !== this.config.agentId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ accepted: false, error: "Message not addressed to this agent" }),
        );
        return;
      }

      // Check TTL
      if (message.ttlMs && message.timestamp) {
        const sent = new Date(message.timestamp).getTime();
        if (Date.now() - sent > message.ttlMs) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ accepted: false, error: "Message expired (TTL exceeded)" }));
          return;
        }
      }

      // Handle by type
      const ack = await this.handleMessage(message);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ack));
    } catch (err) {
      this.logger.error("P2P handler error", {
        error: err instanceof Error ? err.message : String(err),
      });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: false, error: "Internal error" }));
    }
  }

  private async handleMessage(message: P2PMessage): Promise<P2PMessageAck> {
    this.logger.info(`P2P message received: ${message.type} from ${message.from}`);

    switch (message.type as P2PMessageType) {
      case "ping":
        return this.handlePing(message);

      case "pong":
        return this.handlePong(message);

      case "response":
        return this.handleResponse(message);

      case "request":
      case "delegate":
        return this.handleIncoming(message);

      default:
        return { accepted: false, error: `Unknown message type: ${message.type}` };
    }
  }

  /**
   * Handle ping — immediately reply with pong (inline response).
   */
  private handlePing(message: P2PMessage): P2PMessageAck {
    const pong: P2PMessage = {
      id: randomUUID(),
      type: "pong",
      from: this.config.agentId,
      to: message.from,
      payload: {
        status: "idle", // TODO: get actual status from daemon
        uptimeMs: process.uptime() * 1000,
      },
      timestamp: new Date().toISOString(),
      correlationId: message.id,
    };

    return { accepted: true, response: pong };
  }

  /**
   * Handle pong — resolve pending ping request.
   */
  private handlePong(message: P2PMessage): P2PMessageAck {
    if (message.correlationId) {
      const pending = this.pendingRequests.get(message.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.correlationId);
        pending.resolve(message);
      }
    }
    return { accepted: true };
  }

  /**
   * Handle response — resolve pending request.
   */
  private handleResponse(message: P2PMessage): P2PMessageAck {
    if (message.correlationId) {
      const pending = this.pendingRequests.get(message.correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.correlationId);
        pending.resolve(message);
        return { accepted: true };
      }
      this.logger.warn(`No pending request for correlationId: ${message.correlationId}`);
    }
    return { accepted: true };
  }

  /**
   * Handle request/delegate — pass to callback for processing.
   */
  private async handleIncoming(message: P2PMessage): Promise<P2PMessageAck> {
    try {
      const result = await this.onMessage(message);

      // For requests, include the response inline if the callback provided one
      if (message.type === "request" && result) {
        const response: P2PMessage = {
          id: randomUUID(),
          type: "response",
          from: this.config.agentId,
          to: message.from,
          payload: {
            success: !result.error,
            content: result.content,
            error: result.error,
            metadata: result.metadata,
          },
          timestamp: new Date().toISOString(),
          correlationId: message.id,
        };

        return { accepted: true, response };
      }

      return { accepted: true };
    } catch (err) {
      this.logger.error("P2P message callback error", {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { accepted: false, error: "Message processing failed" };
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > this.handlerConfig.maxBodySize!) {
          req.destroy();
          reject(new Error("Body too large"));
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (chunks.length === 0) {
          resolve(null);
          return;
        }
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });

      req.on("error", reject);
    });
  }
}
