"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { telemetryApi, type AgentTelemetry } from "@/lib/api";

/**
 * Fetches latest telemetry for a list of agent IDs.
 * Returns a map of agentId → latest telemetry record.
 * Refreshes every `intervalMs` (default 10s).
 */
export function useAgentTelemetry(
  agentIds: string[],
  intervalMs = 10000
): Record<string, AgentTelemetry> {
  const [telemetryMap, setTelemetryMap] = useState<Record<string, AgentTelemetry>>({});
  const idsRef = useRef<string[]>([]);

  // Stable fetch function
  const fetchAll = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((id) => telemetryApi.latest(id))
    );

    const newMap: Record<string, AgentTelemetry> = {};
    results.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value) {
        newMap[ids[i]] = result.value;
      }
    });

    setTelemetryMap((prev) => {
      // Merge — keep old data for agents not in this batch
      return { ...prev, ...newMap };
    });
  }, []);

  useEffect(() => {
    // Only refetch if the list of IDs actually changed
    const sorted = [...agentIds].sort();
    const prevSorted = [...idsRef.current].sort();
    const changed = sorted.length !== prevSorted.length || sorted.some((id, i) => id !== prevSorted[i]);
    
    if (changed) {
      idsRef.current = agentIds;
    }

    fetchAll(agentIds);

    const interval = setInterval(() => fetchAll(agentIds), intervalMs);
    return () => clearInterval(interval);
  }, [agentIds, fetchAll, intervalMs]);

  return telemetryMap;
}
