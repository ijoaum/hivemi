"use client";

import { Agent } from "@/types/agent";

interface StatusBarProps {
  agents: Agent[];
}

export function StatusBar({ agents }: StatusBarProps) {
  const online = agents.filter(a => a.status === "idle" || a.status === "working").length;
  const working = agents.filter(a => a.status === "working").length;
  const idle = agents.filter(a => a.status === "idle").length;
  const error = agents.filter(a => a.status === "error").length;

  return (
    <div className="flex items-center gap-6 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        <span className="text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-900 dark:text-white">{online}</span> online
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span className="text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-900 dark:text-white">{working}</span> working
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-500"></span>
        <span className="text-gray-600 dark:text-gray-400">
          <span className="font-medium text-gray-900 dark:text-white">{idle}</span> idle
        </span>
      </div>
      {error > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          <span className="text-gray-600 dark:text-gray-400">
            <span className="font-medium text-red-600 dark:text-red-400">{error}</span> error
          </span>
        </div>
      )}
    </div>
  );
}
