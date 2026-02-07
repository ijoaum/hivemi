"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Agent, AgentStatus } from "@/types/agent";
import { formatUptime } from "@/data/mock-agents";
import { RoleIcon } from "@/components/role-icon";
import { cn } from "@/lib/utils";
import { Clock, BarChart3, Settings, FileText, Play, Square, RotateCcw, Trash2 } from "lucide-react";

interface AgentCardProps {
  agent: Agent & { roleIcon?: string };
  onViewLogs?: () => void;
  onConfigure?: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  onDelete?: () => void;
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

export function AgentCard({ agent, onViewLogs, onConfigure, onStart, onStop, onRestart, onDelete }: AgentCardProps) {
  const status = statusConfig[agent.status];
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isOnline = agent.status !== "offline";

  // Close menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [menuOpen]);

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
          <div className="w-5 h-5 md:w-6 md:h-6 text-amber-500 shrink-0">
            <RoleIcon icon={agent.roleIcon || "bot"} className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm md:text-base font-semibold text-gray-900 dark:text-white truncate">
              <Link href={`/agents/${agent.id}`} className="hover:text-amber-400 transition-colors">
                {agent.name}
              </Link>
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

          {/* Settings gear with dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={cn(
                "p-1.5 md:p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded active:bg-gray-200 dark:active:bg-gray-700",
                menuOpen && "bg-gray-100 dark:bg-gray-800"
              )}
              title="Agent actions"
            >
              <Settings className={cn("w-4 h-4 transition-transform", menuOpen && "rotate-90")} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 bottom-full mb-2 w-44 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
                {/* Start / Stop */}
                {isOnline ? (
                  <button
                    onClick={() => { setMenuOpen(false); onStop?.(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => { setMenuOpen(false); onStart?.(); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-green-400 hover:bg-green-500/10 transition-colors"
                  >
                    <Play className="w-4 h-4" />
                    Start
                  </button>
                )}

                {/* Restart */}
                <button
                  onClick={() => { setMenuOpen(false); onRestart?.(); }}
                  disabled={!isOnline}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart
                </button>

                <div className="border-t border-gray-700" />

                {/* Delete */}
                <button
                  onClick={() => { setMenuOpen(false); onDelete?.(); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
