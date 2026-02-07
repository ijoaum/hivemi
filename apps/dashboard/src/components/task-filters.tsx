"use client";

import { TaskStatus } from "@/types/task";
import { cn } from "@/lib/utils";

interface TaskFiltersProps {
  selectedStatus: TaskStatus | "all";
  onStatusChange: (status: TaskStatus | "all") => void;
  selectedTeam: string | "all";
  onTeamChange: (team: string | "all") => void;
  teams: string[];
}

const statusOptions: { value: TaskStatus | "all"; label: string; color: string }[] = [
  { value: "all", label: "All", color: "bg-gray-600" },
  { value: "queued", label: "Queued", color: "bg-gray-500" },
  { value: "running", label: "Running", color: "bg-blue-500" },
  { value: "completed", label: "Completed", color: "bg-green-500" },
  { value: "failed", label: "Failed", color: "bg-red-500" },
];

export function TaskFilters({
  selectedStatus,
  onStatusChange,
  selectedTeam,
  onTeamChange,
  teams,
}: TaskFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 mb-6">
      {/* Status filters */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Status:</span>
        <div className="flex gap-1">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onStatusChange(option.value)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-lg transition-colors",
                selectedStatus === option.value
                  ? `${option.color} text-white`
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Team filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">Team:</span>
        <select
          value={selectedTeam}
          onChange={(e) => onTeamChange(e.target.value)}
          className="bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gray-600"
        >
          <option value="all">All Teams</option>
          {teams.map((team) => (
            <option key={team} value={team}>
              {team}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
