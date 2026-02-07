"use client";

import { useCallback, useMemo } from "react";
import { useApi } from "@/hooks/use-api";
import { tasksApi, agentsApi, teamsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface TaskDetailModalProps {
  taskId: string;
  isOpen: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}

const statusColors: Record<string, string> = {
  queued: "bg-gray-500/20 text-gray-400",
  running: "bg-amber-500/20 text-amber-400",
  completed: "bg-green-500/20 text-green-400",
  failed: "bg-red-500/20 text-red-400",
  cancelled: "bg-gray-500/20 text-gray-400",
};

const priorityColors: Record<string, string> = {
  high: "bg-red-500/20 text-red-400",
  medium: "bg-amber-500/20 text-amber-400",
  low: "bg-gray-500/20 text-gray-400",
};

export function TaskDetailModal({ taskId, isOpen, onClose, onRetry, onCancel }: TaskDetailModalProps) {
  const taskFetcher = useCallback(() => tasksApi.get(taskId), [taskId]);
  const agentsFetcher = useCallback(() => agentsApi.list(), []);
  const teamsFetcher = useCallback(() => teamsApi.list(), []);

  const { data: task, error, isLoading } = useApi(taskFetcher, { refetchInterval: 2000 });
  const { data: agents } = useApi(agentsFetcher);
  const { data: teams } = useApi(teamsFetcher);

  const agent = useMemo(() => agents?.find(a => a.id === task?.agentId), [agents, task]);
  const team = useMemo(() => teams?.find(t => t.id === task?.teamId), [teams, task]);

  const handleRetry = async () => {
    await tasksApi.retry(taskId);
    onRetry?.();
  };

  const handleCancel = async () => {
    await tasksApi.cancel(taskId);
    onCancel?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white">Task Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-auto flex-1">
          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : error || !task ? (
            <div className="text-center py-8 text-red-400">Failed to load task</div>
          ) : (
            <div className="space-y-6">
              {/* Title & Status */}
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">{task.title}</h3>
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs px-2 py-1 rounded-full capitalize", statusColors[task.status])}>
                    {task.status}
                  </span>
                  <span className={cn("text-xs px-2 py-1 rounded-full capitalize", priorityColors[task.priority])}>
                    {task.priority} priority
                  </span>
                </div>
              </div>

              {/* Description */}
              {task.description && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Description</h4>
                  <p className="text-gray-300">{task.description}</p>
                </div>
              )}

              {/* Meta */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-1">Team</h4>
                  <p className="text-white">{team?.emoji} {team?.name || "Unknown"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-1">Assigned To</h4>
                  <p className="text-white">{agent?.name || "Unassigned"}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-1">Created</h4>
                  <p className="text-white">{new Date(task.createdAt).toLocaleString()}</p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-1">Started</h4>
                  <p className="text-white">
                    {task.startedAt ? new Date(task.startedAt).toLocaleString() : "-"}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-1">Completed</h4>
                  <p className="text-white">
                    {task.completedAt ? new Date(task.completedAt).toLocaleString() : "-"}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-1">Duration</h4>
                  <p className="text-white">
                    {task.elapsedMs ? `${(task.elapsedMs / 1000).toFixed(1)}s` : "-"}
                  </p>
                </div>
              </div>

              {/* Input */}
              {task.input && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Input</h4>
                  <pre className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-sm text-gray-300 overflow-auto max-h-32 font-mono">
                    {task.input}
                  </pre>
                </div>
              )}

              {/* Output */}
              {task.output && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Output</h4>
                  <pre className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-sm text-gray-300 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                    {task.output}
                  </pre>
                </div>
              )}

              {/* Error */}
              {task.error && (
                <div>
                  <h4 className="text-sm font-medium text-red-400 mb-2">Error</h4>
                  <pre className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-300 overflow-auto max-h-32 font-mono">
                    {task.error}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {task && (
          <div className="flex gap-3 p-6 border-t border-gray-800">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
            >
              Close
            </button>
            {task.status === "failed" && (
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-amber-500/20 border border-amber-500/50 text-amber-400 rounded-lg hover:bg-amber-500/30"
              >
                Retry
              </button>
            )}
            {(task.status === "queued" || task.status === "running") && (
              <button
                onClick={handleCancel}
                className="px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
