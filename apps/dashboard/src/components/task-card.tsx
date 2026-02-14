"use client";

import { useState } from "react";
import { Task, TaskStatus, TaskPriority } from "@/types/task";
import { tasksApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Loader2, XCircle } from "lucide-react";
import { ConfirmDialog } from "./confirm-dialog";

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  onCancelComplete?: () => void;
}

const statusConfig: Record<TaskStatus, { color: string; bg: string; label: string }> = {
  queued: { color: "text-gray-400", bg: "bg-gray-500/20", label: "Queued" },
  locked: { color: "text-blue-400", bg: "bg-blue-500/20", label: "Running" },
  completed: { color: "text-green-400", bg: "bg-green-500/20", label: "Completed" },
  failed: { color: "text-red-400", bg: "bg-red-500/20", label: "Failed" },
  cancelling: { color: "text-yellow-400", bg: "bg-yellow-500/20", label: "Cancelling" },
  cancelled: { color: "text-gray-500", bg: "bg-gray-600/20", label: "Cancelled" },
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

/** Check if a failed task was caused by a timeout */
function isTimeout(task: Task): boolean {
  return task.status === "failed" && (task.error === "timeout" || !!task.timeoutAt);
}

export function TaskCard({ task, onClick, onCancelComplete }: TaskCardProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const timeout = isTimeout(task);
  const status = timeout
    ? { color: "text-orange-400", bg: "bg-orange-500/20", label: "Timed Out" }
    : statusConfig[task.status];
  const priority = priorityConfig[task.priority];
  
  const progress = task.estimatedMs && task.elapsedMs 
    ? Math.min((task.elapsedMs / task.estimatedMs) * 100, 100)
    : 0;

  const handleCancelClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger card onClick
    setCancelError(null);
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = async () => {
    setIsCancelling(true);
    setCancelError(null);
    try {
      await tasksApi.cancel(task.id);
      onCancelComplete?.();
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Failed to cancel task");
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 cursor-pointer",
        "hover:bg-gray-800 hover:border-gray-600 transition-all",
        task.status === "failed" && !timeout && "border-red-500/30",
        timeout && "border-orange-500/30",
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-white truncate">{task.title}</h3>
            {timeout && (
              <span className="text-orange-400 flex-shrink-0" title="Task timed out">
                ⏱️
              </span>
            )}
          </div>
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

      {/* Timeout message */}
      {timeout && (
        <div className="mb-3 p-2 bg-orange-500/10 border border-orange-500/20 rounded text-xs text-orange-400 font-mono truncate">
          ⏱️ Task timed out — no heartbeat from agent
        </div>
      )}

      {/* Error message (non-timeout) */}
      {task.status === "failed" && task.error && !timeout && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 font-mono truncate">
          {task.error}
        </div>
      )}

      {/* Cancel error */}
      {cancelError && (
        <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
          {cancelError}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className={cn("text-xs px-2 py-1 rounded-full", status.bg, status.color)}>
          {status.label}
        </span>
        <div className="flex items-center gap-2">
          {/* Cancel button for running tasks */}
          {task.status === "locked" && (
            <button
              onClick={handleCancelClick}
              disabled={isCancelling}
              className={cn(
                "text-xs px-2 py-1 rounded-full flex items-center gap-1 transition-colors",
                isCancelling
                  ? "bg-yellow-500/20 text-yellow-400 cursor-not-allowed opacity-70"
                  : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
              )}
            >
              {isCancelling ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              {isCancelling ? "Cancelling" : "Cancel"}
            </button>
          )}
          {/* Cancelling state indicator */}
          {task.status === "cancelling" && (
            <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Cancelling
            </span>
          )}
          <span className="text-xs text-gray-500">
            {formatRelativeTime(task.createdAt)}
          </span>
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      <ConfirmDialog
        isOpen={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleCancelConfirm}
        title="Cancel Task"
        message={`Are you sure you want to cancel "${task.title}"? The agent will stop processing it.`}
        confirmLabel="Cancel Task"
        isDestructive
      />
    </div>
  );
}
