"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { telemetryApi, type AgentTelemetry } from "@/lib/api";

/**
 * Fetches latest telemetry + 24h history for a single agent.
 * Used on the agent detail page for gauges & sparklines.
 * Refreshes every `intervalMs` (default 15s).
 */
export function useAgentDetailTelemetry(
  agentId: string,
  intervalMs = 15000
) {
  const [latest, setLatest] = useState<AgentTelemetry | null>(null);
  const [history, setHistory] = useState<AgentTelemetry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const [latestResult, historyResult] = await Promise.allSettled([
        telemetryApi.latest(agentId),
        telemetryApi.history(agentId, { limit: 200 }),
      ]);

      if (!mountedRef.current) return;

      if (latestResult.status === "fulfilled") {
        setLatest(latestResult.value);
      }
      if (historyResult.status === "fulfilled") {
        // History comes in desc order, reverse for chronological sparklines
        setHistory([...historyResult.value].reverse());
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [agentId]);

  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);
    fetchData();

    const interval = setInterval(fetchData, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData, intervalMs]);

  return { latest, history, isLoading };
}
