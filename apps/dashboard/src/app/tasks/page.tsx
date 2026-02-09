"use client";

import { useState, useCallback, useMemo } from "react";
import { TaskCard } from "@/components/task-card";
import { TaskFilters } from "@/components/task-filters";
import { useApi } from "@/hooks/use-api";
import { tasksApi, teamsApi, type Task } from "@/lib/api";
import { TaskStatus } from "@/types/task";

export default function TasksPage() {
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | "all">("all");
  const [selectedTeam, setSelectedTeam] = useState<string | "all">("all");

  // Fetch from API
  const tasksFetcher = useCallback(() => tasksApi.list(), []);
  const teamsFetcher = useCallback(() => teamsApi.list(), []);
  
  const { data: apiTasks, error: tasksError, refetch: refetchTasks } = useApi(tasksFetcher, { refetchInterval: 5000, cacheKey: "tasks" });
  const { data: apiTeams } = useApi(teamsFetcher, { cacheKey: "teams" });

  // Convert API tasks to display format
  const tasks = useMemo(() => {
    if (!apiTasks?.length) return [];
    return apiTasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || "",
      status: t.status as TaskStatus,
      priority: t.priority,
      assignedTo: t.agentId || undefined,
      teamId: t.teamId,
      teamName: apiTeams?.find(team => team.id === t.teamId)?.name || "Unknown",
      teamEmoji: apiTeams?.find(team => team.id === t.teamId)?.emoji || "hexagon",
      progress: t.status === "locked" ? 50 : t.status === "completed" ? 100 : 0,
      createdAt: t.createdAt,
      startedAt: t.startedAt || undefined,
      completedAt: t.completedAt || undefined,
      error: t.error || undefined,
    }));
  }, [apiTasks, apiTeams, tasksError]);

  // Get unique teams
  const teams = useMemo(() => {
    return [...new Set(tasks.map((t) => t.teamName))];
  }, [tasks]);

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (selectedStatus !== "all" && task.status !== selectedStatus) return false;
      if (selectedTeam !== "all" && task.teamName !== selectedTeam) return false;
      return true;
    });
  }, [tasks, selectedStatus, selectedTeam]);

  // Group by status for counts
  const statusCounts = useMemo(() => ({
    queued: tasks.filter((t) => t.status === "queued").length,
    running: tasks.filter((t) => t.status === "locked").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  }), [tasks]);

  const handleRetry = async (taskId: string) => {
    try {
      await tasksApi.retry(taskId);
      refetchTasks();
    } catch (err) {
      console.error("Failed to retry task:", err);
    }
  };

  const handleCancel = async (taskId: string) => {
    try {
      await tasksApi.cancel(taskId);
      refetchTasks();
    } catch (err) {
      console.error("Failed to cancel task:", err);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Tasks</h1>
        <p className="text-sm md:text-base text-gray-400">
          Monitor and manage agent tasks
          {tasksError && <span className="text-amber-500 ml-2">(API unavailable)</span>}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-gray-400">{statusCounts.queued}</div>
          <div className="text-xs md:text-sm text-gray-500">Queued</div>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-blue-400">{statusCounts.running}</div>
          <div className="text-xs md:text-sm text-blue-400/70">Running</div>
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-green-400">{statusCounts.completed}</div>
          <div className="text-xs md:text-sm text-green-400/70">Completed</div>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-red-400">{statusCounts.failed}</div>
          <div className="text-xs md:text-sm text-red-400/70">Failed</div>
        </div>
      </div>

      {/* Filters */}
      <TaskFilters
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        selectedTeam={selectedTeam}
        onTeamChange={setSelectedTeam}
        teams={teams}
      />

      {/* Task list */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
        {filteredTasks.map((task) => (
          <TaskCard 
            key={task.id} 
            task={task as any}
          />
        ))}
      </div>

      {filteredTasks.length === 0 && (
        <div className="text-center py-8 md:py-12 text-gray-500">
          No tasks match the current filters
        </div>
      )}
    </>
  );
}
