"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Agent, AgentStatus } from "@/types/agent";
import { RoleIcon } from "@/components/role-icon";
import { cn } from "@/lib/utils";
import {
  Clock,
  BarChart3,
  Settings,
  FileText,
  Play,
  Square,
  RotateCcw,
  Trash2,
  Cpu,
  Activity,
  Cloud,
  Globe,
  Heart,
} from "lucide-react";
import type { AgentTelemetry } from "@/lib/api";

// =============================================================================
// Types
// =============================================================================

interface AgentCardProps {
  agent: Agent & {
    roleIcon?: string;
    roleColor?: string;
    model?: string;
    cloud?: { provider: string; region: string; instanceId: string } | null;
  };
  telemetry?: AgentTelemetry | null;
  onViewLogs?: () => void;
  onConfigure?: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  onDelete?: () => void;
}

// =============================================================================
// Status Config
// =============================================================================

const statusConfig: Record<
  AgentStatus,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    dotColor: string;
    label: string;
  }
> = {
  provisioning: {
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950",
    borderColor: "border-blue-400 dark:border-blue-500",
    dotColor: "bg-blue-500",
    label: "Provisioning",
  },
  working: {
    color: "text-emerald-700 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950",
    borderColor: "border-emerald-400 dark:border-emerald-500",
    dotColor: "bg-emerald-500",
    label: "Working",
  },
  idle: {
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950",
    borderColor: "border-amber-400 dark:border-amber-500",
    dotColor: "bg-amber-500",
    label: "Idle",
  },
  error: {
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950",
    borderColor: "border-red-400 dark:border-red-500",
    dotColor: "bg-red-500",
    label: "Error",
  },
  offline: {
    color: "text-gray-500 dark:text-gray-500",
    bgColor: "bg-gray-100 dark:bg-gray-900",
    borderColor: "border-gray-300 dark:border-gray-700",
    dotColor: "bg-gray-400",
    label: "Offline",
  },
  unreachable: {
    color: "text-yellow-700 dark:text-yellow-400",
    bgColor: "bg-yellow-50 dark:bg-yellow-950",
    borderColor: "border-yellow-400 dark:border-yellow-500",
    dotColor: "bg-yellow-500",
    label: "Unreachable",
  },
  destroyed: {
    color: "text-gray-400 dark:text-gray-600",
    bgColor: "bg-gray-100 dark:bg-gray-900",
    borderColor: "border-gray-200 dark:border-gray-800",
    dotColor: "bg-gray-300 dark:bg-gray-700",
    label: "Destroyed",
  },
};

const roleColorClasses: Record<string, string> = {
  blue: "text-blue-400",
  purple: "text-purple-400",
  cyan: "text-cyan-400",
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  pink: "text-pink-400",
  indigo: "text-indigo-400",
};

// =============================================================================
// Helpers
// =============================================================================

/** Format seconds into human-readable uptime string */
function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Compute health level from CPU + memory usage */
function getHealthLevel(cpu: number, memPercent: number): "green" | "yellow" | "red" {
  const avg = (cpu + memPercent) / 2;
  if (avg >= 80) return "red";
  if (avg >= 60) return "yellow";
  return "green";
}

const healthColors = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
} as const;

const healthLabels = {
  green: "Healthy",
  yellow: "Warning",
  red: "Critical",
} as const;

/** Provider display info */
const providerInfo: Record<string, { label: string; icon: string }> = {
  digitalocean: { label: "DO", icon: "🌊" },
  gcp: { label: "GCP", icon: "☁️" },
};

/** Shorten region name (e.g., "nyc1" → "NYC1", "us-central1" → "us-central1") */
function formatRegion(region: string): string {
  return region.length <= 6 ? region.toUpperCase() : region;
}

/** Format bytes to human-readable */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// =============================================================================
// Component
// =============================================================================

export function AgentCard({
  agent,
  telemetry,
  onViewLogs,
  onConfigure,
  onStart,
  onStop,
  onRestart,
  onDelete,
}: AgentCardProps) {
  const status = statusConfig[agent.status];
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const isOnline = agent.status !== "offline" && agent.status !== "destroyed";
  const isDestroyed = agent.status === "destroyed";
  const isOfflineOrUnreachable =
    agent.status === "offline" || agent.status === "unreachable" || agent.status === "destroyed";

  // Telemetry data extraction
  const infra = telemetry?.infra ?? null;
  const daemon = telemetry?.daemon ?? null;
  const tasksTelemetry = telemetry?.tasks ?? null;
  const llm = telemetry?.llm ?? null;

  // Computed values
  const memPercent = infra ? Math.round((infra.memUsed / infra.memTotal) * 100) : null;
  const healthLevel =
    infra && memPercent !== null ? getHealthLevel(infra.cpu, memPercent) : null;
  const tasksToday = tasksTelemetry ? tasksTelemetry.completed + tasksTelemetry.failed : null;
  const uptimeSeconds = daemon?.uptime ?? 0;
  const cloudInfo = agent.cloud ?? null;
  const provider = cloudInfo ? providerInfo[cloudInfo.provider] : null;

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

  return (
    <div
      className={cn(
        "rounded-lg border p-3 md:p-4 transition-all duration-300 relative",
        "bg-white dark:bg-gray-900",
        status.borderColor,
        agent.status === "working" && "animate-pulse-subtle",
        agent.status === "provisioning" && "animate-pulse-subtle",
        isOfflineOrUnreachable && "opacity-60"
      )}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2 md:mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "w-5 h-5 md:w-6 md:h-6 shrink-0",
              roleColorClasses[agent.roleColor || ""] || "text-amber-500"
            )}
          >
            <RoleIcon icon={agent.roleIcon || "bot"} className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white truncate">
              <Link
                href={`/agents/${agent.id}`}
                className="hover:text-amber-400 transition-colors"
              >
                {agent.name}
              </Link>
            </h3>
            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 truncate">
              {agent.role}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
          {/* Health indicator dot — color based on CPU+RAM */}
          {healthLevel && !isOfflineOrUnreachable ? (
            <span
              className={cn(
                "w-2 h-2 md:w-2.5 md:h-2.5 rounded-full",
                healthColors[healthLevel],
                agent.status === "working" && "animate-pulse"
              )}
              title={`Health: ${healthLabels[healthLevel]} (CPU: ${infra?.cpu.toFixed(0)}%, RAM: ${memPercent}%)`}
            />
          ) : (
            <span
              className={cn(
                "w-2 h-2 md:w-2.5 md:h-2.5 rounded-full",
                status.dotColor,
                agent.status === "working" && "animate-pulse"
              )}
            />
          )}
          <span className="text-xs md:text-sm text-gray-500 hidden sm:inline">
            {status.label}
          </span>
        </div>
      </div>

      {/* Task - compact */}
      {agent.currentTask && (
        <p
          className={cn(
            "text-xs md:text-sm truncate mb-2 md:mb-3 px-2 py-1 md:py-1.5 rounded",
            status.bgColor,
            status.color
          )}
        >
          {agent.currentTask}
        </p>
      )}

      {/* Model + Cloud Provider row */}
      <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 dark:text-gray-400">
        {agent.model && (
          <span className="truncate max-w-[120px]" title={agent.model}>
            {agent.model}
          </span>
        )}
        {provider && cloudInfo && (
          <span className="flex items-center gap-0.5 shrink-0" title={`${cloudInfo.provider} — ${cloudInfo.region}`}>
            <span>{provider.icon}</span>
            <span>{formatRegion(cloudInfo.region)}</span>
          </span>
        )}
      </div>

      {/* Stats Row */}
      <div className="flex items-center justify-between text-xs md:text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2 md:gap-4">
          {/* Uptime — real from daemon telemetry */}
          <span className="flex items-center gap-1" title={`Uptime: ${formatUptime(uptimeSeconds)}`}>
            <Clock className="w-3 h-3 md:w-4 md:h-4" />
            {uptimeSeconds > 0 ? formatUptime(uptimeSeconds) : "—"}
          </span>
          {/* Tasks today — real from telemetry */}
          <span className="hidden sm:flex items-center gap-1" title={`Tasks: ${tasksToday ?? "—"} (${tasksTelemetry?.completed ?? 0} completed, ${tasksTelemetry?.failed ?? 0} failed)`}>
            <BarChart3 className="w-3 h-3 md:w-4 md:h-4" />
            {tasksToday !== null ? tasksToday : "—"}
          </span>
        </div>
        <div className="flex items-center gap-0.5 md:gap-1">
          {/* Tooltip trigger — details on hover */}
          <div
            className="relative"
            ref={tooltipRef}
            onMouseEnter={() => setTooltipOpen(true)}
            onMouseLeave={() => setTooltipOpen(false)}
          >
            <button
              className="p-1.5 md:p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded active:bg-gray-200 dark:active:bg-gray-700"
              title="Agent details"
            >
              <Activity className="w-4 h-4" />
            </button>

            {/* Tooltip */}
            {tooltipOpen && (
              <div className="absolute right-0 bottom-full mb-2 w-56 bg-gray-900 dark:bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3 z-50 text-xs text-gray-300">
                <div className="space-y-1.5">
                  {/* Health */}
                  {healthLevel && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Heart className="w-3 h-3" /> Health
                      </span>
                      <span className={cn(
                        "font-medium",
                        healthLevel === "green" && "text-emerald-400",
                        healthLevel === "yellow" && "text-yellow-400",
                        healthLevel === "red" && "text-red-400",
                      )}>
                        {healthLabels[healthLevel]}
                      </span>
                    </div>
                  )}
                  {/* CPU */}
                  {infra && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Cpu className="w-3 h-3" /> CPU
                      </span>
                      <span>{infra.cpu.toFixed(1)}%</span>
                    </div>
                  )}
                  {/* Memory */}
                  {infra && memPercent !== null && (
                    <div className="flex items-center justify-between">
                      <span>RAM</span>
                      <span>
                        {formatBytes(infra.memUsed)} / {formatBytes(infra.memTotal)} ({memPercent}%)
                      </span>
                    </div>
                  )}
                  {/* Disk */}
                  {infra && infra.diskTotal > 0 && (
                    <div className="flex items-center justify-between">
                      <span>Disk</span>
                      <span>
                        {formatBytes(infra.diskUsed)} / {formatBytes(infra.diskTotal)}
                      </span>
                    </div>
                  )}
                  {/* Uptime */}
                  {daemon && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Uptime
                      </span>
                      <span>{formatUptime(daemon.uptime)}</span>
                    </div>
                  )}
                  {/* Daemon version */}
                  {daemon && (
                    <div className="flex items-center justify-between">
                      <span>Daemon</span>
                      <span>v{daemon.version}</span>
                    </div>
                  )}
                  {/* OpenClaw status */}
                  {daemon && (
                    <div className="flex items-center justify-between">
                      <span>OpenClaw</span>
                      <span className={cn(
                        daemon.openclawStatus === "running" ? "text-emerald-400" : "text-red-400"
                      )}>
                        {daemon.openclawStatus}
                      </span>
                    </div>
                  )}
                  {/* Model */}
                  {agent.model && (
                    <div className="flex items-center justify-between">
                      <span>Model</span>
                      <span className="truncate max-w-[120px]">{agent.model}</span>
                    </div>
                  )}
                  {/* Cloud */}
                  {cloudInfo && (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Cloud className="w-3 h-3" /> Cloud
                      </span>
                      <span>
                        {provider?.icon} {cloudInfo.provider} / {cloudInfo.region}
                      </span>
                    </div>
                  )}
                  {/* LLM stats */}
                  {llm && llm.requests > 0 && (
                    <>
                      <div className="border-t border-gray-700 pt-1.5 mt-1.5">
                        <span className="text-gray-500">LLM Usage</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Requests</span>
                        <span>{llm.requests}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Tokens</span>
                        <span>{(llm.promptTokens + llm.completionTokens).toLocaleString()}</span>
                      </div>
                      {llm.avgLatencyMs > 0 && (
                        <div className="flex items-center justify-between">
                          <span>Avg latency</span>
                          <span>{llm.avgLatencyMs.toFixed(0)}ms</span>
                        </div>
                      )}
                    </>
                  )}
                  {/* Tasks detail */}
                  {tasksTelemetry && (
                    <>
                      <div className="border-t border-gray-700 pt-1.5 mt-1.5">
                        <span className="text-gray-500">Tasks</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Completed</span>
                        <span className="text-emerald-400">{tasksTelemetry.completed}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Failed</span>
                        <span className={tasksTelemetry.failed > 0 ? "text-red-400" : ""}>
                          {tasksTelemetry.failed}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Active</span>
                        <span className={tasksTelemetry.active > 0 ? "text-amber-400" : ""}>
                          {tasksTelemetry.active}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onViewLogs}
            className="p-1.5 md:p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded active:bg-gray-200 dark:active:bg-gray-700"
            title="View logs"
          >
            <FileText className="w-4 h-4" />
          </button>

          {/* Settings gear with dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={cn(
                "p-1.5 md:p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded active:bg-gray-200 dark:active:bg-gray-700",
                menuOpen && "bg-gray-100 dark:bg-gray-800"
              )}
              title="Agent actions"
            >
              <Settings
                className={cn(
                  "w-4 h-4 transition-transform",
                  menuOpen && "rotate-90"
                )}
              />
            </button>

            {menuOpen && !isDestroyed && (
              <div className="absolute right-0 top-full mt-2 w-44 bg-[#1a1a2e] border border-gray-600 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.7)] overflow-hidden z-50">
                {/* Start / Stop */}
                {isOnline ? (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onStop?.();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onStart?.();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-green-400 hover:bg-green-500/10 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Start
                  </button>
                )}

                {/* Restart */}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onRestart?.();
                  }}
                  disabled={!isOnline}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart
                </button>

                <div className="border-t border-gray-700" />

                {/* Destroy */}
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete?.();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Destroy
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
