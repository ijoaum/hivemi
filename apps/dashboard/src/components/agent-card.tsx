"use client";

import { Agent, AgentStatus } from "@/types/agent";
import { formatUptime } from "@/data/mock-agents";
import { cn } from "@/lib/utils";
import { Bot, Clock, BarChart3, Settings, FileText } from "lucide-react";

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
        "rounded-lg border p-3 md:p-4 transition-all duration-300",
        "bg-white dark:bg-gray-900",
        status.borderColor,
        agent.status === "working" && "animate-pulse-subtle",
        agent.status === "offline" && "opacity-60"
      )}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2 md:mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-5 h-5 md:w-6 md:h-6 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white truncate">
              {agent.name}
            </h3>
            <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 truncate">
              {agent.role}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-1.5 shrink-0">
          <span className={cn("w-2 h-2 md:w-2.5 md:h-2.5 rounded-full", status.dotColor, 
            agent.status === "working" && "animate-pulse")} />
          <span className="text-xs md:text-sm text-gray-500 hidden sm:inline">{status.label}</span>
        </div>
      </div>

      {/* Task - compact */}
      {agent.currentTask && (
        <p className={cn("text-xs md:text-sm truncate mb-2 md:mb-3 px-2 py-1 md:py-1.5 rounded", status.bgColor, status.color)}>
          {agent.currentTask}
        </p>
      )}

      {/* Stats Row */}
      <div className="flex items-center justify-between text-xs md:text-sm text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-2 md:gap-4">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 md:w-4 md:h-4" />
            {formatUptime(agent.uptime)}
          </span>
          <span className="hidden sm:flex items-center gap-1">
            <BarChart3 className="w-3 h-3 md:w-4 md:h-4" />
            {agent.tasksToday}
          </span>
        </div>
        <div className="flex items-center gap-0.5 md:gap-1">
          <button
            onClick={onViewLogs}
            className="p-1.5 md:p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded active:bg-gray-200 dark:active:bg-gray-700"
            title="View logs"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={onConfigure}
            className="p-1.5 md:p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded active:bg-gray-200 dark:active:bg-gray-700"
            title="Configure"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
