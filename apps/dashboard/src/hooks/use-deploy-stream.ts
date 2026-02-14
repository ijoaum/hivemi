"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployPhase {
  name: string;
  status: "pending" | "active" | "completed" | "failed";
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type DeployStatus =
  | "provisioning"
  | "installing"
  | "configuring"
  | "registering"
  | "ready"
  | "failed"
  | "destroyed";

export interface DeployStreamState {
  status: DeployStatus | null;
  phases: DeployPhase[];
  error: string | null;
  connected: boolean;
  finished: boolean;
  agentId: string | null;
}

const PHASE_NAMES = ["provisioning", "installing", "configuring", "registering", "ready"];

function defaultPhases(): DeployPhase[] {
  return PHASE_NAMES.map((name) => ({
    name,
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
  }));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Consumes the SSE stream from /api/deploy/[id]/stream and tracks phase
 * progress in real-time.
 *
 * Returns current state + `connect(deployId)` / `disconnect()` helpers.
 */
export function useDeployStream() {
  const [state, setState] = useState<DeployStreamState>({
    status: null,
    phases: defaultPhases(),
    error: null,
    connected: false,
    finished: false,
    agentId: null,
  });

  const esRef = useRef<EventSource | null>(null);
  const deployIdRef = useRef<string | null>(null);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    deployIdRef.current = null;
  }, []);

  const connect = useCallback(
    (deployId: string) => {
      // Close existing connection
      disconnect();
      deployIdRef.current = deployId;

      // Reset state
      setState({
        status: null,
        phases: defaultPhases(),
        error: null,
        connected: false,
        finished: false,
        agentId: null,
      });

      const es = new EventSource(`/api/deploy/${deployId}/stream`);
      esRef.current = es;

      es.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }));
      };

      es.onerror = () => {
        // EventSource auto-reconnects; mark disconnected
        setState((prev) => ({ ...prev, connected: false }));
      };

      // Handle named events from the backend
      const handleEvent = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data);
          const { type, data } = parsed;

          setState((prev) => {
            const next = { ...prev };

            if (data?.phases) {
              next.phases = data.phases;
            }
            if (data?.status) {
              next.status = data.status;
            }
            if (data?.agentId) {
              next.agentId = data.agentId;
            }

            if (type === "phase_update" && data?.phase) {
              // Update individual phase
              const phaseIdx = next.phases.findIndex((p) => p.name === data.phase.name);
              if (phaseIdx !== -1) {
                next.phases = [...next.phases];
                next.phases[phaseIdx] = data.phase;
              }
            }

            if (type === "error") {
              next.error = data?.error || data?.message || "Unknown error";
              next.finished = true;
            }

            if (type === "complete") {
              next.finished = true;
              // Ensure status reflects completion
              if (data?.status) {
                next.status = data.status;
              }
            }

            if (type === "status_change" && (data?.status === "ready" || data?.status === "failed" || data?.status === "destroyed")) {
              next.finished = true;
              if (data?.status === "failed") {
                next.error = data?.error || prev.error;
              }
            }

            return next;
          });

          // Close stream on terminal events
          if (type === "complete" || type === "error") {
            es.close();
          }
        } catch {
          // Ignore parse errors (heartbeats, etc.)
        }
      };

      // Listen for all event types the backend emits
      es.addEventListener("phase_update", handleEvent);
      es.addEventListener("status_change", handleEvent);
      es.addEventListener("log", handleEvent);
      es.addEventListener("error", handleEvent);
      es.addEventListener("complete", handleEvent);
      // Heartbeats are just keep-alive, no action needed
    },
    [disconnect],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  const reset = useCallback(() => {
    disconnect();
    setState({
      status: null,
      phases: defaultPhases(),
      error: null,
      connected: false,
      finished: false,
      agentId: null,
    });
  }, [disconnect]);

  return { ...state, connect, disconnect, reset };
}
