"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RoleIcon } from "@/components/role-icon";
import { CpuGauge } from "@/components/cpu-gauge";
import { Sparkline } from "@/components/sparkline";
import { useApi } from "@/hooks/use-api";
import { useAgentDetailTelemetry } from "@/hooks/use-agent-detail-telemetry";
import { agentsApi, tasksApi, logsApi, deployApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  MoreVertical,
  Play,
  Square,
  RotateCcw,
  Trash2,
  ArrowLeft,
  Cpu,
  MemoryStick,
  Clock,
  Zap,
  CheckCircle2,
  Cloud,
  Server,
  Globe,
  Package,
  Rocket,
} from "lucide-react";

// =============================================================================
// Status Config
// =============================================================================

const statusColors: Record<string, string> = {
  provisioning: "bg-blue-500 animate-pulse",
  idle: "bg-green-500",
  working: "bg-amber-500 animate-pulse",
  offline: "bg-gray-500",
  unreachable: "bg-yellow-500",
  error: "bg-red-500",
  destroyed: "bg-gray-700",
};

const statusLabels: Record<string, string> = {
  provisioning: "Provisioning",
  idle: "Idle",
  working: "Working",
  offline: "Offline",
  unreachable: "Unreachable",
  error: "Error",
  destroyed: "Destroyed",
};

// =============================================================================
// Helpers
// =============================================================================

function formatUptime(seconds: number): string {
  if (seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

const providerInfo: Record<string, { label: string; icon: string }> = {
  digitalocean: { label: "DigitalOcean", icon: "🌊" },
  gcp: { label: "Google Cloud", icon: "☁️" },
};

const sizeLabels: Record<string, string> = {
  small: "1 vCPU / 1 GB",
  medium: "2 vCPU / 2 GB",
  large: "2 vCPU / 4 GB",
};

// =============================================================================
// Sub-components
// =============================================================================

function MetricCard({
  label,
  value,
  subValue,
  icon: Icon,
  color = "text-gray-400",
  children,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Icon className={cn("w-4 h-4", color)} />
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {subValue && <div className="text-xs text-gray-500">{subValue}</div>}
      {children}
    </div>
  );
}

function MemoryBar({ used, total }: { used: number; total: number }) {
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const color = percent >= 80 ? "bg-red-500" : percent >= 60 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-1">
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{formatBytes(used)}</span>
        <span>{formatBytes(total)}</span>
      </div>
    </div>
  );
}

function SparklineCard({
  label,
  data,
  color,
  currentValue,
  unit,
}: {
  label: string;
  data: number[];
  color: string;
  currentValue?: string | number;
  unit?: string;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">{label}</span>
        {currentValue !== undefined && (
          <span className="text-sm font-medium text-white">
            {currentValue}
            {unit && <span className="text-gray-500 ml-0.5">{unit}</span>}
          </span>
        )}
      </div>
      <Sparkline
        data={data}
        width={280}
        height={40}
        color={color}
        label={label}
        min={0}
        max={label.includes("CPU") || label.includes("Memory") ? 100 : undefined}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-gray-600 mt-1">
        <span>24h ago</span>
        <span>Now</span>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    "delete" | "restart" | "stop" | "destroy" | "force-destroy" | null
  >(null);
  const [actionLoading, setActionLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Data fetching
  const agentFetcher = useCallback(() => agentsApi.get(agentId), [agentId]);
  const tasksFetcher = useCallback(() => tasksApi.list(), []);
  const logsFetcher = useCallback(() => logsApi.list({ limit: 50 }), []);

  const {
    data: agent,
    error: agentError,
    isLoading,
    refetch: refetchAgent,
  } = useApi(agentFetcher, { refetchInterval: 5000, cacheKey: `agent-${agentId}` });
  const { data: allTasks } = useApi(tasksFetcher, { refetchInterval: 5000, cacheKey: "tasks" });
  const { data: allLogs } = useApi(logsFetcher, { refetchInterval: 5000, cacheKey: "logs" });

  // Telemetry (latest + 24h history)
  const { latest: telemetry, history: telemetryHistory } = useAgentDetailTelemetry(agentId);

  // Derived data
  const role = useMemo(() => agent?.role || null, [agent]);
  const team = useMemo(() => agent?.team || null, [agent]);
  const agentTasks = useMemo(
    () => allTasks?.filter((t) => t.agentId === agentId) || [],
    [allTasks, agentId]
  );
  const agentLogs = useMemo(
    () => allLogs?.filter((l) => l.agentId === agentId) || [],
    [allLogs, agentId]
  );

  const isOnline = agent && (agent.status === "idle" || agent.status === "working");
  const isDestroyed = agent?.status === "destroyed";

  // Telemetry values
  const infra = telemetry?.infra ?? null;
  const daemon = telemetry?.daemon ?? null;
  const tasksTelemetry = telemetry?.tasks ?? null;
  const llm = telemetry?.llm ?? null;
  const memPercent = infra ? Math.round((infra.memUsed / infra.memTotal) * 100) : null;

  // Sparkline data arrays
  const cpuHistory = useMemo(
    () => telemetryHistory.filter((t) => t.infra).map((t) => t.infra!.cpu),
    [telemetryHistory]
  );
  const memHistory = useMemo(
    () =>
      telemetryHistory
        .filter((t) => t.infra && t.infra.memTotal > 0)
        .map((t) => Math.round((t.infra!.memUsed / t.infra!.memTotal) * 100)),
    [telemetryHistory]
  );
  const tokensHistory = useMemo(
    () =>
      telemetryHistory
        .filter((t) => t.llm)
        .map((t) => t.llm!.promptTokens + t.llm!.completionTokens),
    [telemetryHistory]
  );

  // Actions
  const handleStart = async () => {
    setActionLoading(true);
    try {
      await agentsApi.update(agentId, { status: "idle" });
      refetchAgent();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await agentsApi.update(agentId, { status: "offline" });
      refetchAgent();
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleRestart = async () => {
    setActionLoading(true);
    try {
      await agentsApi.update(agentId, { status: "offline" });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await agentsApi.update(agentId, { status: "idle" });
      refetchAgent();
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      if (agent?.deployId) {
        try {
          await deployApi.destroy(agent.deployId);
        } catch (err: any) {
          if (err.message?.includes("currently working")) {
            setConfirmAction("force-destroy");
            setActionLoading(false);
            return;
          }
          throw err;
        }
      } else {
        await agentsApi.delete(agentId);
      }
      router.push("/");
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleForceDestroy = async () => {
    setActionLoading(true);
    try {
      if (agent?.deployId) {
        await deployApi.destroy(agent.deployId, true);
      } else {
        await agentsApi.delete(agentId);
      }
      router.push("/");
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  // Loading / Error states
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (agentError || !agent) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400 mb-4">Agent not found</p>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 md:mb-8">
        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={() => router.push("/")}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            {role && (
              <div className="p-2 rounded-lg bg-gray-800">
                <RoleIcon icon={role.icon} className="w-7 h-7 text-amber-400" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold text-white">{agent.name}</h1>
                <span className={cn("w-3 h-3 rounded-full", statusColors[agent.status])} />
                <span className="text-sm text-gray-400">{statusLabels[agent.status]}</span>
              </div>
              <p className="text-gray-400 text-sm mt-0.5">
                {role?.name || "Unknown Role"} • {team?.name || "Unknown Team"}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        {!isDestroyed && (
          <div className="flex items-center gap-2">
            {isOnline ? (
              <button
                onClick={() => setConfirmAction("stop")}
                disabled={actionLoading}
                className="px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={actionLoading}
                className="px-4 py-2 bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                Start
              </button>
            )}

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 bg-gray-800 border border-gray-700 text-gray-400 rounded-lg hover:bg-gray-700 hover:text-white transition-colors"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmAction("restart");
                    }}
                    disabled={!isOnline}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restart
                  </button>
                  <div className="border-t border-gray-700" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmAction("destroy");
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Destroy
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* METRICS SECTION */}
      {/* ================================================================== */}

      {/* Primary Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4 mb-6">
        {/* CPU Gauge */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 flex flex-col items-center justify-center col-span-1">
          <CpuGauge value={infra?.cpu ?? 0} size={90} strokeWidth={7} />
        </div>

        {/* Memory */}
        <MetricCard
          label="Memory"
          value={memPercent !== null ? `${memPercent}%` : "—"}
          subValue={
            infra
              ? `${formatBytes(infra.memUsed)} / ${formatBytes(infra.memTotal)}`
              : undefined
          }
          icon={MemoryStick}
          color="text-purple-400"
        >
          {infra && <MemoryBar used={infra.memUsed} total={infra.memTotal} />}
        </MetricCard>

        {/* Uptime */}
        <MetricCard
          label="Uptime"
          value={daemon ? formatUptime(daemon.uptime) : "—"}
          subValue={daemon?.openclawStatus === "running" ? "OpenClaw running" : undefined}
          icon={Clock}
          color="text-blue-400"
        />

        {/* Tokens Today */}
        <MetricCard
          label="Tokens Today"
          value={
            llm
              ? (llm.promptTokens + llm.completionTokens).toLocaleString()
              : "—"
          }
          subValue={
            llm ? `${llm.requests} requests • ${llm.avgLatencyMs.toFixed(0)}ms avg` : undefined
          }
          icon={Zap}
          color="text-amber-400"
        />

        {/* Tasks Today */}
        <MetricCard
          label="Tasks Today"
          value={
            tasksTelemetry
              ? tasksTelemetry.completed + tasksTelemetry.failed
              : "—"
          }
          subValue={
            tasksTelemetry
              ? `${tasksTelemetry.completed} completed • ${tasksTelemetry.failed} failed`
              : undefined
          }
          icon={CheckCircle2}
          color="text-emerald-400"
        />
      </div>

      {/* Sparklines Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mb-6">
        <SparklineCard
          label="CPU (24h)"
          data={cpuHistory}
          color="#10b981"
          currentValue={infra ? `${infra.cpu.toFixed(1)}` : undefined}
          unit="%"
        />
        <SparklineCard
          label="Memory (24h)"
          data={memHistory}
          color="#a855f7"
          currentValue={memPercent !== null ? `${memPercent}` : undefined}
          unit="%"
        />
        <SparklineCard
          label="Tokens/snapshot (24h)"
          data={tokensHistory}
          color="#f59e0b"
          currentValue={
            llm ? (llm.promptTokens + llm.completionTokens).toLocaleString() : undefined
          }
        />
      </div>

      {/* ================================================================== */}
      {/* MAIN GRID */}
      {/* ================================================================== */}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-white">{agentTasks.length}</div>
              <div className="text-xs md:text-sm text-gray-500">Total Tasks</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-green-400">
                {agentTasks.filter((t) => t.status === "completed").length}
              </div>
              <div className="text-xs md:text-sm text-gray-500">Completed</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-red-400">
                {agentTasks.filter((t) => t.status === "failed").length}
              </div>
              <div className="text-xs md:text-sm text-gray-500">Failed</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-amber-400">
                {agentTasks.filter((t) => t.status === "locked").length}
              </div>
              <div className="text-xs md:text-sm text-gray-500">Active</div>
            </div>
          </div>

          {/* Recent Tasks */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 md:p-6">
            <h2 className="text-lg font-bold text-white mb-4">Recent Tasks</h2>
            {agentTasks.length > 0 ? (
              <div className="space-y-2">
                {agentTasks.slice(0, 5).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg"
                  >
                    <div>
                      <p className="text-white text-sm">{task.title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(task.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-xs px-2 py-1 rounded-full capitalize",
                        task.status === "completed"
                          ? "bg-green-500/20 text-green-400"
                          : task.status === "failed"
                            ? "bg-red-500/20 text-red-400"
                            : task.status === "locked"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-gray-500/20 text-gray-400"
                      )}
                    >
                      {task.status}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No tasks yet</p>
            )}
          </div>

          {/* Logs */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 md:p-6">
            <h2 className="text-lg font-bold text-white mb-4">Recent Logs</h2>
            {agentLogs.length > 0 ? (
              <div className="space-y-1 font-mono text-xs md:text-sm overflow-x-auto">
                {agentLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="flex gap-3 md:gap-4 text-gray-400">
                    <span className="text-gray-600 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={cn(
                        "shrink-0",
                        log.level === "error"
                          ? "text-red-400"
                          : log.level === "warn"
                            ? "text-yellow-400"
                            : log.level === "info"
                              ? "text-blue-400"
                              : "text-gray-400"
                      )}
                    >
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-gray-300">{log.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No logs yet</p>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Deploy Info */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <Rocket className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold text-white">Deploy</h2>
            </div>
            <div className="space-y-3 text-sm">
              {/* Cloud provider */}
              {agent.cloud && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    <Cloud className="w-3.5 h-3.5" /> Cloud Provider
                  </p>
                  <p className="text-white mt-0.5">
                    {providerInfo[agent.cloud.provider]?.icon}{" "}
                    {providerInfo[agent.cloud.provider]?.label || agent.cloud.provider}
                  </p>
                </div>
              )}
              {/* Region */}
              {agent.cloud?.region && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Region
                  </p>
                  <p className="text-white mt-0.5 font-mono text-xs">{agent.cloud.region}</p>
                </div>
              )}
              {/* Private IP */}
              {agent.privateIp && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    <Server className="w-3.5 h-3.5" /> Private IP (VPC)
                  </p>
                  <p className="text-white mt-0.5 font-mono text-xs">{agent.privateIp}</p>
                </div>
              )}
              {/* Public IP */}
              {agent.publicIp && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Public IP
                  </p>
                  <p className="text-white mt-0.5 font-mono text-xs">{agent.publicIp}</p>
                </div>
              )}
              {/* Instance size */}
              {agent.cloud?.instanceId && (
                <div>
                  <p className="text-gray-500">Instance</p>
                  <p className="text-white mt-0.5 font-mono text-xs">{agent.cloud.instanceId}</p>
                </div>
              )}
              {/* Daemon version */}
              {(agent.version || daemon?.version) && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1">
                    <Package className="w-3.5 h-3.5" /> Daemon Version
                  </p>
                  <p className="text-white mt-0.5">v{daemon?.version || agent.version}</p>
                </div>
              )}
              {/* OpenClaw version */}
              {agent.openclawVersion && (
                <div>
                  <p className="text-gray-500">OpenClaw Version</p>
                  <p className="text-white mt-0.5">v{agent.openclawVersion}</p>
                </div>
              )}
              {/* OpenClaw status */}
              {daemon && (
                <div>
                  <p className="text-gray-500">OpenClaw Status</p>
                  <p
                    className={cn(
                      "mt-0.5 font-medium",
                      daemon.openclawStatus === "running" ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {daemon.openclawStatus}
                  </p>
                </div>
              )}
              {/* Deployed time ago */}
              {agent.createdAt && (
                <div>
                  <p className="text-gray-500">Deployed</p>
                  <p className="text-white mt-0.5">
                    {formatTimeAgo(agent.createdAt)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Configuration */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 md:p-6">
            <h2 className="text-lg font-bold text-white mb-4">Configuration</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-gray-500">ID</p>
                <p className="text-white font-mono text-xs">{agent.id}</p>
              </div>
              <div>
                <p className="text-gray-500">Model</p>
                <p className="text-white">{agent.model}</p>
              </div>
              <div>
                <p className="text-gray-500">Endpoint</p>
                <p className="text-white font-mono text-xs">
                  {agent.host}:{agent.port}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Last Heartbeat</p>
                <p className="text-white">
                  {agent.lastHeartbeat
                    ? new Date(agent.lastHeartbeat).toLocaleString()
                    : "Never"}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Created</p>
                <p className="text-white">{new Date(agent.createdAt).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Role Info */}
          {role && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <RoleIcon icon={role.icon} className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">{role.name}</h2>
              </div>
              <p className="text-sm text-gray-400 mb-4">{role.description}</p>
              <div>
                <p className="text-sm text-gray-500 mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-2">
                  {role.capabilities.map((cap, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded"
                    >
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={confirmAction === "stop"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleStop}
        title="Stop Agent"
        message={`Are you sure you want to stop "${agent.name}"? The agent will go offline and stop processing tasks.`}
        confirmLabel="Stop"
        isDestructive={false}
      />

      <ConfirmDialog
        isOpen={confirmAction === "restart"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleRestart}
        title="Restart Agent"
        message={`Are you sure you want to restart "${agent.name}"? The agent will briefly go offline and then come back.`}
        confirmLabel="Restart"
        isDestructive={false}
      />

      <ConfirmDialog
        isOpen={confirmAction === "delete"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleDelete}
        title="Delete Agent"
        message={`Are you sure you want to delete "${agent.name}"? This action cannot be undone. All associated data will be lost.`}
        confirmLabel="Delete"
        isDestructive
      />

      <ConfirmDialog
        isOpen={confirmAction === "destroy"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleDelete}
        title="Destroy Agent"
        message={`Destroy agent ${agent.name}? This will delete the VM and all local data. This action cannot be undone.`}
        confirmLabel="Destroy"
        isDestructive
      />

      <ConfirmDialog
        isOpen={confirmAction === "force-destroy"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleForceDestroy}
        title="Force Destroy Agent"
        message={`Agent ${agent.name} is currently working on a task. Force destroying will abort the task and return it to the queue. Continue?`}
        confirmLabel="Force Destroy"
        isDestructive
      />
    </>
  );
}
