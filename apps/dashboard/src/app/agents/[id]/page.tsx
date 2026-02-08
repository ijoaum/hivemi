"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RoleIcon } from "@/components/role-icon";
import { useApi } from "@/hooks/use-api";
import { agentsApi, tasksApi, logsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  MoreVertical,
  Play,
  Square,
  RotateCcw,
  Trash2,
  ArrowLeft,
  ChevronDown,
} from "lucide-react";

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

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"delete" | "restart" | "stop" | null>(null);
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

  const agentFetcher = useCallback(() => agentsApi.get(agentId), [agentId]);
  const tasksFetcher = useCallback(() => tasksApi.list(), []);
  const logsFetcher = useCallback(() => logsApi.list({ limit: 50 }), []);

  const { data: agent, error: agentError, isLoading, refetch: refetchAgent } = useApi(agentFetcher, { refetchInterval: 5000, cacheKey: `agent-${agentId}` });
  const { data: allTasks } = useApi(tasksFetcher, { refetchInterval: 5000, cacheKey: "tasks" });
  const { data: allLogs } = useApi(logsFetcher, { refetchInterval: 5000, cacheKey: "logs" });

  const role = useMemo(() => agent?.role || null, [agent]);
  const team = useMemo(() => agent?.team || null, [agent]);
  const agentTasks = useMemo(() => allTasks?.filter(t => t.agentId === agentId) || [], [allTasks, agentId]);
  const agentLogs = useMemo(() => allLogs?.filter(l => l.agentId === agentId) || [], [allLogs, agentId]);

  const isOnline = agent && (agent.status === "idle" || agent.status === "working");

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
      // Small delay to simulate restart
      await new Promise(resolve => setTimeout(resolve, 500));
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
      await agentsApi.delete(agentId);
      router.push("/");
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

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
        <div className="flex items-center gap-2">
          {/* Primary action: Start or Stop */}
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

          {/* More actions dropdown */}
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
                  onClick={() => { setMenuOpen(false); setConfirmAction("restart"); }}
                  disabled={!isOnline}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart
                </button>
                <div className="border-t border-gray-700" />
                <button
                  onClick={() => { setMenuOpen(false); setConfirmAction("delete"); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Agent
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-white">{agentTasks.length}</div>
              <div className="text-xs md:text-sm text-gray-500">Total Tasks</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-green-400">
                {agentTasks.filter(t => t.status === "completed").length}
              </div>
              <div className="text-xs md:text-sm text-gray-500">Completed</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-red-400">
                {agentTasks.filter(t => t.status === "failed").length}
              </div>
              <div className="text-xs md:text-sm text-gray-500">Failed</div>
            </div>
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
              <div className="text-xl md:text-2xl font-bold text-amber-400">
                {agentTasks.filter(t => t.status === "locked").length}
              </div>
              <div className="text-xs md:text-sm text-gray-500">Active</div>
            </div>
          </div>

          {/* Recent Tasks */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 md:p-6">
            <h2 className="text-lg font-bold text-white mb-4">Recent Tasks</h2>
            {agentTasks.length > 0 ? (
              <div className="space-y-2">
                {agentTasks.slice(0, 5).map(task => (
                  <div key={task.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
                    <div>
                      <p className="text-white text-sm">{task.title}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(task.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <span className={cn(
                      "text-xs px-2 py-1 rounded-full capitalize",
                      task.status === "completed" ? "bg-green-500/20 text-green-400" :
                      task.status === "failed" ? "bg-red-500/20 text-red-400" :
                      task.status === "locked" ? "bg-amber-500/20 text-amber-400" :
                      "bg-gray-500/20 text-gray-400"
                    )}>
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
                {agentLogs.slice(0, 10).map(log => (
                  <div key={log.id} className="flex gap-3 md:gap-4 text-gray-400">
                    <span className="text-gray-600 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={cn(
                      "shrink-0",
                      log.level === "error" ? "text-red-400" :
                      log.level === "warn" ? "text-yellow-400" :
                      log.level === "info" ? "text-blue-400" : "text-gray-400"
                    )}>
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

        {/* Sidebar Info */}
        <div className="space-y-6">
          {/* Agent Info */}
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 md:p-6">
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
                <p className="text-white font-mono text-xs">{agent.host}:{agent.port}</p>
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
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 md:p-6">
              <div className="flex items-center gap-2 mb-4">
                <RoleIcon icon={role.icon} className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-bold text-white">{role.name}</h2>
              </div>
              <p className="text-sm text-gray-400 mb-4">{role.description}</p>
              <div>
                <p className="text-sm text-gray-500 mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-2">
                  {role.capabilities.map((cap, i) => (
                    <span key={i} className="text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stop Confirmation */}
      <ConfirmDialog
        isOpen={confirmAction === "stop"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleStop}
        title="Stop Agent"
        message={`Are you sure you want to stop "${agent.name}"? The agent will go offline and stop processing tasks.`}
        confirmLabel="Stop"
        isDestructive={false}
      />

      {/* Restart Confirmation */}
      <ConfirmDialog
        isOpen={confirmAction === "restart"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleRestart}
        title="Restart Agent"
        message={`Are you sure you want to restart "${agent.name}"? The agent will briefly go offline and then come back.`}
        confirmLabel="Restart"
        isDestructive={false}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={confirmAction === "delete"}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleDelete}
        title="Delete Agent"
        message={`Are you sure you want to delete "${agent.name}"? This action cannot be undone. All associated data will be lost.`}
        confirmLabel="Delete"
        isDestructive
      />
    </>
  );
}
