"use client";

import { Role } from "@/types/role";
import { cn } from "@/lib/utils";

interface RoleCardProps {
  role: Role;
  onClick?: () => void;
}

const colorClasses: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-400" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-400" },
  cyan: { bg: "bg-cyan-500/10", border: "border-cyan-500/30", text: "text-cyan-400" },
  green: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-400" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400" },
  red: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400" },
  pink: { bg: "bg-pink-500/10", border: "border-pink-500/30", text: "text-pink-400" },
  indigo: { bg: "bg-indigo-500/10", border: "border-indigo-500/30", text: "text-indigo-400" },
};

export function RoleCard({ role, onClick }: RoleCardProps) {
  const colors = colorClasses[role.color] || colorClasses.blue;

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl p-6 cursor-pointer transition-all",
        "border hover:scale-[1.02]",
        colors.bg,
        colors.border
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{role.icon}</span>
          <div>
            <h3 className={cn("text-lg font-semibold", colors.text)}>{role.name}</h3>
            <p className="text-sm text-gray-500">@{role.slug}</p>
          </div>
        </div>
        <div className="text-right">
          <div className={cn("text-2xl font-bold", colors.text)}>{role.agentCount}</div>
          <div className="text-xs text-gray-500">agents</div>
        </div>
      </div>

      {/* Description */}
      <p className="text-gray-400 text-sm mb-4">{role.description}</p>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-2 mb-4">
        {role.capabilities.slice(0, 3).map((cap) => (
          <span
            key={cap}
            className={cn(
              "text-xs px-2 py-1 rounded-full",
              "bg-gray-800 text-gray-400"
            )}
          >
            {cap}
          </span>
        ))}
        {role.capabilities.length > 3 && (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-500">
            +{role.capabilities.length - 3}
          </span>
        )}
      </div>

      {/* System prompt preview */}
      <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800">
        <p className="text-xs text-gray-500 mb-1">System Prompt</p>
        <p className="text-xs text-gray-400 font-mono line-clamp-2">
          {role.systemPromptPreview}
        </p>
      </div>
    </div>
  );
}
