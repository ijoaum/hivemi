"use client";

import { useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { useApi } from "@/hooks/use-api";
import { agentsApi, rolesApi, teamsApi, tasksApi, logsApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-green-500",
  working: "bg-amber-500 animate-pulse",
  offline: "bg-gray-500",
  error: "bg-red-500",
};

const statusLabels: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  working: "Working",
  offline: "Offline",
  error: "Error",
};

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;

  const agentFetcher = useCallback(() => agentsApi.get(agentId), [agentId]);
  const rolesFetcher = useCallback(() => rolesApi.list(), []);
  const teamsFetcher = useCallback(() => teamsApi.list(), []);
  const tasksFetcher = useCallback(() => tasksApi.list(), []);
  const logsFetcher = useCallback(() => logsApi.list({ limit: 50 }), []);

  const { data: agent, error: agentError, isLoading } = useApi(agentFetcher, { refetchInterval: 5000 });
  const { data: roles } = useApi(rolesFetcher);
  const { data: teams } = useApi(teamsFetcher);
  const { data: allTasks } = useApi(tasksFetcher, { refetchInterval: 5000 });
  const { data: allLogs } = useApi(logsFetcher, { refetchInterval: 5000 });

  const role = useMemo(() => roles?.find(r => r.id === agent?.roleId), [roles, agent]);
  const team = useMemo(() => teams?.find(t => t.id === agent?.teamId), [teams, agent]);
  const agentTasks = useMemo(() => allTasks?.filter(t => t.agentId === agentId) || [], [allTasks, agentId]);
  const agentLogs = useMemo(() => allLogs?.filter(l => l.agentId === agentId) || [], [allLogs, agentId]);

  const handleStop = async () => {
    if (!agent) return;
    await agentsApi.update(agentId, { status: "offline" });
  };

  const handleStart = async () => {
    if (!agent) return;
    await agentsApi.update(agentId, { status: "idle" });
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this agent?")) return;
    await agentsApi.delete(agentId);
    router.push("/");
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-gray-950">
        <Sidebar />
        <main className="flex-1 p-8 flex items-center justify-center">
          <div className="text-gray-400">Loading...</div>
        </main>
      </div>
    );
  }

  if (agentError || !agent) {
    return (
      <div className="flex min-h-screen bg-gray-950">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="text-center py-12">
            <p className="text-red-400 mb-4">Agent not found</p>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
            >
              Back to Dashboard
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/")}
              className="text-gray-400 hover:text-white"
            >
              ← Back
            </button>
            <div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">{role?.icon || "🤖"}</span>
                <h1 className="text-3xl font-bold text-white">{agent.name}</h1>
                <span className={cn("w-3 h-3 rounded-full", statusColors[agent.status])} />
                <span className="text-gray-400">{statusLabels[agent.status]}</span>
              </div>
              <p className="text-gray-400 mt-1">
                {role?.name || "Unknown Role"} • {team?.emoji} {team?.name || "Unknown Team"}
              </p>
            </div>
          </div>
          
          <div className="flex gap-2">
            {agent.status === "offline" ? (
              <button
                onClick={handleStart}
                className="px-4 py-2 bg-green-500/20 border border-green-500/50 text-green-400 rounded-lg hover:bg-green-500/30"
              >
                Start
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700"
              >
                Stop
              </button>
            )}
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30"
            >
              Delete
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Info */}
          <div className="col-span-2 space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
                <div className="text-2xl font-bold text-white">{agentTasks.length}</div>
                <div className="text-sm text-gray-500">Total Tasks</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-400">
                  {agentTasks.filter(t => t.status === "completed").length}
                </div>
                <div className="text-sm text-gray-500">Completed</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
                <div className="text-2xl font-bold text-red-400">
                  {agentTasks.filter(t => t.status === "failed").length}
                </div>
                <div className="text-sm text-gray-500">Failed</div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
                <div className="text-2xl font-bold text-amber-400">
                  {agentTasks.filter(t => t.status === "running").length}
                </div>
                <div className="text-sm text-gray-500">Running</div>
              </div>
            </div>

            {/* Recent Tasks */}
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-6">
              <h2 className="text-lg font-bold text-white mb-4">Recent Tasks</h2>
              {agentTasks.length > 0 ? (
                <div className="space-y-2">
                  {agentTasks.slice(0, 5).map(task => (
                    <div key={task.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
                      <div>
                        <p className="text-white">{task.title}</p>
                        <p className="text-sm text-gray-500">
                          {new Date(task.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <span className={cn(
                        "text-xs px-2 py-1 rounded-full capitalize",
                        task.status === "completed" ? "bg-green-500/20 text-green-400" :
                        task.status === "failed" ? "bg-red-500/20 text-red-400" :
                        task.status === "running" ? "bg-amber-500/20 text-amber-400" :
                        "bg-gray-500/20 text-gray-400"
                      )}>
                        {task.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No tasks yet</p>
              )}
            </div>

            {/* Logs */}
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-6">
              <h2 className="text-lg font-bold text-white mb-4">Recent Logs</h2>
              {agentLogs.length > 0 ? (
                <div className="space-y-1 font-mono text-sm">
                  {agentLogs.slice(0, 10).map(log => (
                    <div key={log.id} className="flex gap-4 text-gray-400">
                      <span className="text-gray-600">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className={cn(
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
                <p className="text-gray-500">No logs yet</p>
              )}
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            {/* Agent Info */}
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-6">
              <h2 className="text-lg font-bold text-white mb-4">Configuration</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-500">ID</p>
                  <p className="text-white font-mono">{agent.id.slice(0, 8)}...</p>
                </div>
                <div>
                  <p className="text-gray-500">Model</p>
                  <p className="text-white">{agent.model}</p>
                </div>
                <div>
                  <p className="text-gray-500">Endpoint</p>
                  <p className="text-white font-mono">{agent.host}:{agent.port}</p>
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
              <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-6">
                <h2 className="text-lg font-bold text-white mb-4">Role: {role.name}</h2>
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
      </main>
    </div>
  );
}
