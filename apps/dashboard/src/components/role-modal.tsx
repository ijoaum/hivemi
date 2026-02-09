"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Loader2, Save } from "lucide-react";
import { RoleIcon, iconMap } from "./role-icon";

interface RoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: RoleFormData) => Promise<void>;
  role?: RoleFormData & { id?: string };
  mode: "create" | "edit";
}

export interface RoleFormData {
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  capabilities: string[];
  systemPrompt: string;
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

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function RoleModal({ isOpen, onClose, onSave, role, mode }: RoleModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("bot");
  const [color, setColor] = useState("blue");
  const [capabilities, setCapabilities] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [autoSlug, setAutoSlug] = useState(true);

  useEffect(() => {
    if (role) {
      setName(role.name);
      setSlug(role.slug);
      setDescription(role.description);
      setIcon(role.icon);
      setColor(role.color);
      setCapabilities(role.capabilities.join(", "));
      setSystemPrompt(role.systemPrompt);
      setAutoSlug(false);
    } else {
      setName("");
      setSlug("");
      setDescription("");
      setIcon("bot");
      setColor("blue");
      setCapabilities("");
      setSystemPrompt("");
      setAutoSlug(true);
    }
  }, [role, isOpen]);

  if (!isOpen) return null;

  const handleNameChange = (value: string) => {
    setName(value);
    if (autoSlug) {
      setSlug(slugify(value));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        name,
        slug,
        description,
        icon,
        color,
        capabilities: capabilities.split(",").map(c => c.trim()).filter(Boolean),
        systemPrompt,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-xl font-semibold text-white">
            {mode === "create" ? "Create New Role" : "Edit Role"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name & Slug */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., Tech Lead"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Slug</label>
              <input
                type="text"
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setAutoSlug(false); }}
                placeholder="e.g., tech-lead"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors font-mono text-sm"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this role do?"
              required
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors resize-none"
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

          {/* Capabilities */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Capabilities (comma-separated)</label>
            <input
              type="text"
              value={capabilities}
              onChange={(e) => setCapabilities(e.target.value)}
              placeholder="e.g., code-review, architecture, mentoring"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a..."
              required
              rows={4}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors resize-none font-mono text-sm"
            />
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
              disabled={!name || !slug || !description || !systemPrompt || isSaving}
              className={cn(
                "flex-1 px-4 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                name && slug && description && systemPrompt && !isSaving
                  ? "bg-amber-500 hover:bg-amber-600 text-black"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              )}
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                <><Save className="w-4 h-4" /> {mode === "create" ? "Create Role" : "Save Changes"}</>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
