// =============================================================================
// OpenClaw Interceptor — Issue #89
//
// Intercepts tool calls from the OpenClaw Chat Completions SSE stream.
// The interceptor wraps the standard SSE parser to detect tool_calls in
// streaming chunks and emits events for each detected tool call.
//
// OpenClaw's Chat Completions API (when using tools) sends streaming chunks
// that include tool_calls in the delta:
//
//   data: {"choices":[{"delta":{"tool_calls":[{"id":"call_123","function":{"name":"exec","arguments":"{...}"}}]}}]}
//
// The interceptor collects these across chunks (tool calls can be split
// across multiple SSE events) and emits a ToolCallEvent when a tool call
// is complete (detected by receiving a new tool call index or stream end).
// =============================================================================

import type { DaemonLogger } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Event emitted when a tool call is detected in the stream.
 */
export interface ToolCallEvent {
  /** Tool call ID from OpenClaw (e.g. "call_abc123") */
  callId: string;
  /** Tool name (e.g. "exec", "read", "write", "web_search") */
  toolName: string;
  /** Raw arguments JSON string (truncated for reporting) */
  arguments: string;
  /** Summarized arguments for human-readable display */
  argumentsSummary: string;
  /** Timestamp when the tool call was first detected */
  timestamp: Date;
}

/**
 * Callback invoked for each intercepted tool call.
 */
export type ToolCallCallback = (event: ToolCallEvent) => void;

/**
 * Configuration for the interceptor.
 */
export interface InterceptorConfig {
  /** Whether interception is enabled (default: true) */
  enabled: boolean;
  /** Max length of arguments summary (default: 100) */
  maxArgsSummaryLength: number;
}

const DEFAULT_INTERCEPTOR_CONFIG: InterceptorConfig = {
  enabled: true,
  maxArgsSummaryLength: 100,
};

// ---------------------------------------------------------------------------
// Streaming chunk types (from OpenClaw Chat Completions SSE)
// ---------------------------------------------------------------------------

interface StreamToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface StreamChunk {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: StreamToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Tool Call Accumulator — collects tool call fragments across chunks
// ---------------------------------------------------------------------------

interface ToolCallAccumulator {
  callId: string;
  toolName: string;
  arguments: string;
  firstSeen: Date;
}

// ---------------------------------------------------------------------------
// OpenClaw Interceptor
// ---------------------------------------------------------------------------

export class OpenClawInterceptor {
  private readonly config: InterceptorConfig;
  private readonly logger: DaemonLogger;
  private readonly callbacks: ToolCallCallback[] = [];

  /** Active tool call accumulators (keyed by index in the choices array) */
  private accumulators: Map<number, ToolCallAccumulator> = new Map();

  constructor(logger: DaemonLogger, config: Partial<InterceptorConfig> = {}) {
    this.config = { ...DEFAULT_INTERCEPTOR_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Register a callback for tool call events.
   */
  onToolCall(callback: ToolCallCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Process a raw SSE data line (the JSON payload after "data: ").
   * Call this for each SSE data event during streaming.
   *
   * Returns the content delta (if any) for the standard content accumulation.
   */
  processChunk(data: string): string | null {
    if (data === "[DONE]") {
      // Stream complete — flush any remaining tool calls
      this.flush();
      return null;
    }

    let parsed: StreamChunk;
    try {
      parsed = JSON.parse(data) as StreamChunk;
    } catch {
      return null;
    }

    const choice = parsed.choices?.[0];
    if (!choice?.delta) return null;

    // Process tool calls if present
    if (this.config.enabled && choice.delta.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        this.processToolCallDelta(tc);
      }
    }

    // Return content delta for standard accumulation
    return choice.delta.content ?? null;
  }

  /**
   * Process a single tool call delta from a streaming chunk.
   */
  private processToolCallDelta(delta: StreamToolCallDelta): void {
    const index = delta.index ?? 0;

    if (delta.id) {
      // New tool call starting — flush previous one at this index if any
      const existing = this.accumulators.get(index);
      if (existing) {
        this.emitToolCall(existing);
      }

      // Start new accumulator
      this.accumulators.set(index, {
        callId: delta.id,
        toolName: delta.function?.name ?? "unknown",
        arguments: delta.function?.arguments ?? "",
        firstSeen: new Date(),
      });

      this.logger.debug(`Tool call detected: ${delta.function?.name ?? "unknown"}`, {
        callId: delta.id,
        index,
      });
    } else {
      // Continuation of existing tool call — append arguments
      const acc = this.accumulators.get(index);
      if (acc) {
        if (delta.function?.name) {
          acc.toolName = delta.function.name;
        }
        if (delta.function?.arguments) {
          acc.arguments += delta.function.arguments;
        }
      }
    }
  }

  /**
   * Flush all remaining accumulators (called at stream end).
   */
  flush(): void {
    for (const [_index, acc] of this.accumulators) {
      this.emitToolCall(acc);
    }
    this.accumulators.clear();
  }

  /**
   * Reset the interceptor state (between tasks).
   */
  reset(): void {
    this.accumulators.clear();
  }

  /**
   * Emit a tool call event to all registered callbacks.
   */
  private emitToolCall(acc: ToolCallAccumulator): void {
    const event: ToolCallEvent = {
      callId: acc.callId,
      toolName: acc.toolName,
      arguments: acc.arguments,
      argumentsSummary: this.summarizeArguments(acc.toolName, acc.arguments),
      timestamp: acc.firstSeen,
    };

    this.logger.debug(`Tool call complete: ${event.toolName}`, {
      callId: event.callId,
      summary: event.argumentsSummary,
    });

    for (const cb of this.callbacks) {
      try {
        cb(event);
      } catch (err) {
        this.logger.warn("Tool call callback error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Create a human-readable summary of tool call arguments.
   * Extracts the most relevant info based on tool name.
   */
  private summarizeArguments(toolName: string, argsJson: string): string {
    const maxLen = this.config.maxArgsSummaryLength;

    if (!argsJson || argsJson.trim() === "") {
      return "(no args)";
    }

    try {
      const args = JSON.parse(argsJson) as Record<string, unknown>;

      // Tool-specific summaries
      switch (toolName) {
        case "exec": {
          const cmd = args.command ?? args.cmd;
          if (typeof cmd === "string") {
            return truncate(`$ ${cmd}`, maxLen);
          }
          break;
        }
        case "read": {
          const path = args.path ?? args.file_path;
          if (typeof path === "string") {
            return truncate(`📄 ${path}`, maxLen);
          }
          break;
        }
        case "write": {
          const path = args.path ?? args.file_path;
          if (typeof path === "string") {
            return truncate(`✏️ ${path}`, maxLen);
          }
          break;
        }
        case "edit": {
          const path = args.path ?? args.file_path;
          if (typeof path === "string") {
            return truncate(`🔧 ${path}`, maxLen);
          }
          break;
        }
        case "web_search": {
          const query = args.query;
          if (typeof query === "string") {
            return truncate(`🔍 ${query}`, maxLen);
          }
          break;
        }
        case "web_fetch": {
          const url = args.url;
          if (typeof url === "string") {
            return truncate(`🌐 ${url}`, maxLen);
          }
          break;
        }
        case "browser": {
          const action = args.action;
          if (typeof action === "string") {
            return truncate(`🖥️ browser:${action}`, maxLen);
          }
          break;
        }
      }

      // Generic fallback: show first key-value pair
      const keys = Object.keys(args);
      if (keys.length > 0) {
        const firstKey = keys[0];
        const firstVal = String(args[firstKey]);
        return truncate(`${firstKey}: ${firstVal}`, maxLen);
      }

      return truncate(argsJson, maxLen);
    } catch {
      // Not valid JSON — return truncated raw string
      return truncate(argsJson, maxLen);
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}
