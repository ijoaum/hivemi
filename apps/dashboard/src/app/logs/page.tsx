"use client";

import { useState, useMemo, useCallback } from "react";
import { useApi } from "@/hooks/use-api";
import { logsApi } from "@/lib/api";
import { mockLogs } from "@/data/mock-logs";
import { LogLevel } from "@/types/log";
import { cn } from "@/lib/utils";
import { Radio } from "lucide-react";

const levelConfig: Record<LogLevel, { color: string; bg: string; label: string }> = {
  debug: { color: "text-gray-400", bg: "bg-gray-500/20", label: "DEBUG" },
  info: { color: "text-blue-400", bg: "bg-blue-500/20", label: "INFO" },
  warn: { color: "text-yellow-400", bg: "bg-yellow-500/20", label: "WARN" },
  error: { color: "text-red-400", bg: "bg-red-500/20", label: "ERROR" },
  lifecycle: { color: "text-green-400", bg: "bg-green-500/20", label: "LIFE" },
};

function formatTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function LogsPage() {
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | "all">("all");
  const [selectedSource, setSelectedSource] = useState<string | "all">("all");
  const [selectedAgent, setSelectedAgent] = useState<string | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  // Fetch from API
  const logsFetcher = useCallback(() => logsApi.list({ limit: 500 }), []);
  const { data: apiLogs, error: logsError } = useApi(logsFetcher, { refetchInterval: 5000, cacheKey: "logs" });

  // Convert API logs to display format or fall back to mock
  const allLogs = useMemo(() => {
    if (logsError || !apiLogs?.length) {
      return mockLogs;
    }
    return apiLogs.map(l => ({
      id: l.id,
      timestamp: new Date(l.timestamp),
      level: l.level as LogLevel,
      source: l.source,
      agentId: l.agentId || undefined,
      agentName: undefined,
      taskId: l.taskId || undefined,
      message: l.message,
      metadata: l.metadata || undefined,
    }));
  }, [apiLogs, logsError]);

  const sources = useMemo(() => [...new Set(allLogs.map((l) => l.source))], [allLogs]);
  const agentIds = useMemo(() => [...new Set(allLogs.map((l) => l.agentId).filter(Boolean) as string[])], [allLogs]);

  const filteredLogs = useMemo(() => {
    return allLogs.filter((log) => {
      if (!showDebug && log.level === "debug") return false;
      if (selectedLevel !== "all" && log.level !== selectedLevel) return false;
      if (selectedSource !== "all" && log.source !== selectedSource) return false;
      if (selectedAgent !== "all" && log.agentId !== selectedAgent) return false;
      if (searchQuery && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [allLogs, selectedLevel, selectedSource, selectedAgent, searchQuery, showDebug]);

  const levelCounts = useMemo(() => ({
    error: allLogs.filter((l) => l.level === "error").length,
    warn: allLogs.filter((l) => l.level === "warn").length,
    info: allLogs.filter((l) => l.level === "info").length,
    debug: allLogs.filter((l) => l.level === "debug").length,
    lifecycle: allLogs.filter((l) => l.level === "lifecycle").length,
  }), [allLogs]);

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Logs</h1>
          <p className="text-sm md:text-base text-gray-400">
            Real-time system and agent logs
            {logsError && <span className="text-amber-500 ml-2">(using mock data)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button className="px-3 md:px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm md:text-base">
            Export
          </button>
          <button className="px-3 md:px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg transition-colors text-sm md:text-base flex items-center gap-2">
            <Radio className="w-4 h-4" /> Live
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-4 md:mb-6">
        <button
          onClick={() => setSelectedLevel(selectedLevel === "error" ? "all" : "error")}
          className={cn(
            "p-3 md:p-4 rounded-lg border transition-all",
            selectedLevel === "error"
              ? "bg-red-500/20 border-red-500/50"
              : "bg-gray-800/50 border-gray-700/50 hover:border-gray-600"
          )}
        >
          <div className="text-xl md:text-2xl font-bold text-red-400">{levelCounts.error}</div>
          <div className="text-xs md:text-sm text-gray-500">Errors</div>
        </button>
        <button
          onClick={() => setSelectedLevel(selectedLevel === "warn" ? "all" : "warn")}
          className={cn(
            "p-3 md:p-4 rounded-lg border transition-all",
            selectedLevel === "warn"
              ? "bg-yellow-500/20 border-yellow-500/50"
              : "bg-gray-800/50 border-gray-700/50 hover:border-gray-600"
          )}
        >
          <div className="text-xl md:text-2xl font-bold text-yellow-400">{levelCounts.warn}</div>
          <div className="text-xs md:text-sm text-gray-500">Warnings</div>
        </button>
        <button
          onClick={() => setSelectedLevel(selectedLevel === "info" ? "all" : "info")}
          className={cn(
            "p-3 md:p-4 rounded-lg border transition-all",
            selectedLevel === "info"
              ? "bg-blue-500/20 border-blue-500/50"
              : "bg-gray-800/50 border-gray-700/50 hover:border-gray-600"
          )}
        >
          <div className="text-xl md:text-2xl font-bold text-blue-400">{levelCounts.info}</div>
          <div className="text-xs md:text-sm text-gray-500">Info</div>
        </button>
        <button
          onClick={() => {
            setShowDebug(!showDebug);
            if (!showDebug) setSelectedLevel("debug");
            else if (selectedLevel === "debug") setSelectedLevel("all");
          }}
          className={cn(
            "p-3 md:p-4 rounded-lg border transition-all",
            showDebug && selectedLevel === "debug"
              ? "bg-gray-500/20 border-gray-500/50"
              : "bg-gray-800/50 border-gray-700/50 hover:border-gray-600"
          )}
        >
          <div className="text-xl md:text-2xl font-bold text-gray-400">{levelCounts.debug}</div>
          <div className="text-xs md:text-sm text-gray-500">Debug</div>
        </button>
        <button
          onClick={() => setSelectedLevel(selectedLevel === "lifecycle" ? "all" : "lifecycle")}
          className={cn(
            "p-3 md:p-4 rounded-lg border transition-all",
            selectedLevel === "lifecycle"
              ? "bg-green-500/20 border-green-500/50"
              : "bg-gray-800/50 border-gray-700/50 hover:border-gray-600"
          )}
        >
          <div className="text-xl md:text-2xl font-bold text-green-400">{levelCounts.lifecycle}</div>
          <div className="text-xs md:text-sm text-gray-500">Lifecycle</div>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 md:gap-4 mb-4">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-gray-600 text-sm md:text-base"
          />
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-gray-600 text-sm md:text-base"
          >
            <option value="all">All Sources</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
          {agentIds.length > 0 && (
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-gray-600 text-sm md:text-base"
            >
              <option value="all">All Agents</option>
              {agentIds.map((id) => (
                <option key={id} value={id}>
                  {id.slice(0, 8)}…
                </option>
              ))}
            </select>
          )}
          <label className="hidden sm:flex items-center gap-2 text-gray-400 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="rounded bg-gray-800 border-gray-600"
            />
            Show debug
          </label>
        </div>
      </div>

      {/* Log entries */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden font-mono text-xs md:text-sm">
        {filteredLogs.map((log) => {
          const level = levelConfig[log.level];
          return (
            <div
              key={log.id}
              className={cn(
                "flex flex-wrap md:flex-nowrap items-start gap-2 md:gap-4 px-3 md:px-4 py-2 border-b border-gray-800/50 hover:bg-gray-800/30",
                log.level === "error" && "bg-red-500/5"
              )}
            >
              {/* Timestamp */}
              <span className="text-gray-500 flex-shrink-0 w-16 md:w-20">
                {formatTimestamp(log.timestamp)}
              </span>

              {/* Level */}
              <span
                className={cn(
                  "flex-shrink-0 w-12 md:w-14 text-xs font-medium px-1 md:px-1.5 py-0.5 rounded text-center",
                  level.bg,
                  level.color
                )}
              >
                {level.label}
              </span>

              {/* Source - hidden on mobile */}
              <span className="hidden md:inline text-purple-400 flex-shrink-0 w-20">
                [{log.source}]
              </span>

              {/* Agent */}
              {log.agentName && (
                <span className="text-cyan-400 flex-shrink-0">
                  @{log.agentName.toLowerCase()}
                </span>
              )}

              {/* Message */}
              <span className="text-gray-300 flex-1 break-all">{log.message}</span>

              {/* Metadata indicator */}
              {log.metadata && (
                <span className="hidden md:inline text-gray-600 flex-shrink-0" title={JSON.stringify(log.metadata, null, 2)}>
                  {"{ ... }"}
                </span>
              )}
            </div>
          );
        })}

        {filteredLogs.length === 0 && (
          <div className="text-center py-6 md:py-8 text-gray-500">
            No logs match the current filters
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 md:mt-4 flex items-center justify-between text-xs md:text-sm text-gray-500">
        <span>Showing {filteredLogs.length} of {allLogs.length}</span>
        <span>Auto-refresh: 5s</span>
      </div>
    </>
  );
}
