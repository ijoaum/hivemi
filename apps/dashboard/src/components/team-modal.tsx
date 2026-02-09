"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Loader2, Save } from "lucide-react";
import { RoleIcon, iconMap } from "@/components/role-icon";

interface TeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: TeamFormData) => Promise<void>;
  team?: TeamFormData & { id?: string };
  mode: "create" | "edit";
}

export interface TeamFormData {
  name: string;
  emoji: string; // stores icon name (e.g. "blocks", "rocket")
  color: string;
}

const colorOptions = [
  { name: "blue", label: "Blue" },
  { name: "purple", label: "Purple" },
  { name: "cyan", label: "Cyan" },
  { name: "green", label: "Green" },
  { name: "amber", label: "Amber" },
  { name: "red", label: "Red" },
  { name: "pink", label: "Pink" },
  { name: "indigo", label: "Indigo" },
];

const colorClasses: Record<string, string> = {
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  cyan: "bg-cyan-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  pink: "bg-pink-500",
  indigo: "bg-indigo-500",
};

const iconOptions = Object.keys(iconMap);

export function TeamModal({ isOpen, onClose, onSave, team, mode }: TeamModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("blocks");
  const [color, setColor] = useState("blue");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name);
      setIcon(team.emoji);
      setColor(team.color);
    } else {
      setName("");
      setIcon("blocks");
      setColor("blue");
    }
  }, [team, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({ name, emoji: icon, color });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-xl font-semibold text-white">
            {mode === "create" ? "Create New Team" : "Edit Team"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Team Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Core Platform"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Icon */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Icon</label>
            <div className="flex flex-wrap gap-2">
              {iconOptions.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    "p-2.5 rounded-lg border transition-all",
                    icon === iconName
                      ? "bg-amber-500/20 border-amber-500 text-amber-400"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  )}
                  title={iconName}
                >
                  <RoleIcon icon={iconName} className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setColor(c.name)}
                  className={cn(
                    "w-10 h-10 rounded-lg border-2 transition-all flex items-center justify-center",
                    colorClasses[c.name],
                    color === c.name
                      ? "border-white scale-110"
                      : "border-transparent opacity-60 hover:opacity-80"
                  )}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name || isSaving}
              className={cn(
                "flex-1 px-4 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                name && !isSaving
                  ? "bg-amber-500 hover:bg-amber-600 text-black"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              )}
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                <><Save className="w-4 h-4" /> {mode === "create" ? "Create Team" : "Save Changes"}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
