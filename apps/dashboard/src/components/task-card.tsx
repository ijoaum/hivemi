"use client";

import { Task, TaskStatus, TaskPriority } from "@/types/task";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
}

const statusConfig: Record<TaskStatus, { color: string; bg: string; label: string }> = {
  queued: { color: "text-gray-400", bg: "bg-gray-500/20", label: "Queued" },
  running: { color: "text-blue-400", bg: "bg-blue-500/20", label: "Running" },
  completed: { color: "text-green-400", bg: "bg-green-500/20", label: "Completed" },
  failed: { color: "text-red-400", bg: "bg-red-500/20", label: "Failed" },
};

const priorityConfig: Record<TaskPriority, { color: string; icon: string }> = {
  high: { color: "text-red-400", icon: "🔴" },
  medium: { color: "text-yellow-400", icon: "🟡" },
  low: { color: "text-gray-400", icon: "⚪" },
};

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const status = statusConfig[task.status];
  const priority = priorityConfig[task.priority];
  
  const progress = task.estimatedMs && task.elapsedMs 
    ? Math.min((task.elapsedMs / task.estimatedMs) * 100, 100)
    : 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 cursor-pointer",
        "hover:bg-gray-800 hover:border-gray-600 transition-all",
        task.status === "failed" && "border-red-500/30"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-white truncate">{task.title}</h3>
          <p className="text-sm text-gray-400 mt-1">
            {task.agentName} • {task.teamName}
          </p>
        </div>
        <span className="text-lg" title={`${task.priority} priority`}>
          {priority.icon}
        </span>
      </div>

      {/* Progress bar for running tasks */}
      {task.status === "locked" && task.estimatedMs && (
        <div className="mb-3">
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{formatTime(task.elapsedMs || 0)}</span>
            <span>{formatTime(task.estimatedMs)}</span>
          </div>
        </div>
      )}

      {/* Error message */}
      {task.status === "failed" && task.error && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 font-mono truncate">
          {task.error}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className={cn("text-xs px-2 py-1 rounded-full", status.bg, status.color)}>
          {status.label}
        </span>
        <span className="text-xs text-gray-500">
          {formatRelativeTime(task.createdAt)}
        </span>
      </div>
    </div>
  );
}
