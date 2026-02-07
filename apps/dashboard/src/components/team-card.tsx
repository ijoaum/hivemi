"use client";

import { cn } from "@/lib/utils";
import { Pencil, Trash2, Users } from "lucide-react";
import { RoleIcon } from "@/components/role-icon";
import type { Team } from "@/lib/api";

interface TeamCardProps {
  team: Team;
  agentCount: number;
  onEdit?: () => void;
  onDelete?: () => void;
}

const colorClasses: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400", badge: "bg-blue-500/20" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400", badge: "bg-purple-500/20" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400", badge: "bg-cyan-500/20" },
  green: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400", badge: "bg-green-500/20" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", badge: "bg-amber-500/20" },
  red: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", badge: "bg-red-500/20" },
  pink: { bg: "bg-pink-500/10", border: "border-pink-500/30", text: "text-pink-400", badge: "bg-pink-500/20" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/30", text: "text-indigo-400", badge: "bg-indigo-500/20" },
};

export function TeamCard({ team, agentCount, onEdit, onDelete }: TeamCardProps) {
  const colors = colorClasses[team.color] || colorClasses.blue;

  return (
    <div
      className={cn(
        "rounded-xl p-6 transition-all group",
        "border hover:scale-[1.02]",
        colors.bg,
        colors.border,
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", colors.bg, colors.text)}>
            <RoleIcon icon={team.emoji} className="w-7 h-7" />
          </div>
          <div>
            <h3 className={cn("text-lg font-semibold", colors.text)}>{team.name}</h3>
            <p className="text-sm text-gray-500">
              Created {new Date(team.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Edit/Delete buttons */}
          {(onEdit || onDelete) && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {onEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  className="p-1.5 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors"
                  title="Edit team"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                  title="Delete team"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Agent count */}
      <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg", colors.badge)}>
        <Users className={cn("w-4 h-4", colors.text)} />
        <span className={cn("text-sm font-medium", colors.text)}>
          {agentCount} {agentCount === 1 ? "agent" : "agents"}
        </span>
      </div>
    </div>
  );
}
