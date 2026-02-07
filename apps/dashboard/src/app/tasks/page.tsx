"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { TaskCard } from "@/components/task-card";
import { TaskFilters } from "@/components/task-filters";
import { mockTasks } from "@/data/mock-tasks";
import { TaskStatus } from "@/types/task";

export default function TasksPage() {
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus | "all">("all");
  const [selectedTeam, setSelectedTeam] = useState<string | "all">("all");

  // Get unique teams
  const teams = [...new Set(mockTasks.map((t) => t.teamName))];

  // Filter tasks
  const filteredTasks = mockTasks.filter((task) => {
    if (selectedStatus !== "all" && task.status !== selectedStatus) return false;
    if (selectedTeam !== "all" && task.teamName !== selectedTeam) return false;
    return true;
  });

  // Group by status for counts
  const statusCounts = {
    queued: mockTasks.filter((t) => t.status === "queued").length,
    running: mockTasks.filter((t) => t.status === "running").length,
    completed: mockTasks.filter((t) => t.status === "completed").length,
    failed: mockTasks.filter((t) => t.status === "failed").length,
  };

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Tasks</h1>
          <p className="text-gray-400">Monitor and manage agent tasks</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-400">{statusCounts.queued}</div>
            <div className="text-sm text-gray-500">Queued</div>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-400">{statusCounts.running}</div>
            <div className="text-sm text-blue-400/70">Running</div>
          </div>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-400">{statusCounts.completed}</div>
            <div className="text-sm text-green-400/70">Completed</div>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="text-2xl font-bold text-red-400">{statusCounts.failed}</div>
            <div className="text-sm text-red-400/70">Failed</div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>

        {filteredTasks.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No tasks match the current filters
          </div>
        )}
      </main>
    </div>
  );
}
