"use client";

import { Agent, AgentStatus } from "@/types/agent";
import { formatUptime } from "@/data/mock-agents";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
  onViewLogs?: () => void;
  onConfigure?: () => void;
}

const statusConfig: Record<AgentStatus, { 
  color: string; 
  bgColor: string; 
  borderColor: string;
  dotColor: string;
  label: string;
}> = {
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
};

export function AgentCard({ agent, onViewLogs, onConfigure }: AgentCardProps) {
  const status = statusConfig[agent.status];
  
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-all duration-300",
        "bg-white dark:bg-gray-900",
        status.borderColor,
        agent.status === "working" && "animate-pulse-subtle",
        agent.status === "offline" && "opacity-60"
      )}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">🐝</span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {agent.name}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
              {agent.role}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("w-2.5 h-2.5 rounded-full", status.dotColor, 
            agent.status === "working" && "animate-pulse")} />
          <span className="text-sm text-gray-500">{status.label}</span>
        </div>
      </div>

      {/* Task - compact */}
      {agent.currentTask && (
        <p className={cn("text-sm truncate mb-3 px-2 py-1.5 rounded", status.bgColor, status.color)}>
          {agent.currentTask}
        </p>
      )}

      {/* Stats Row */}
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span>⏱️ {formatUptime(agent.uptime)}</span>
          <span>📊 {agent.tasksToday}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onViewLogs}
            className="px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm"
          >
            Logs
          </button>
          <button
            onClick={onConfigure}
            className="px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm"
          >
            ⚙️
          </button>
        </div>
      </div>
    </div>
  );
}
