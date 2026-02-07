"use client";

import { useState, useCallback } from "react";
import { useApi } from "@/hooks/use-api";
import { demandsApi, teamsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { X, Loader2 } from "lucide-react";

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateTaskModal({ isOpen, onClose, onCreated }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [teamId, setTeamId] = useState("");
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamsFetcher = useCallback(() => teamsApi.list(), []);
  const { data: teams } = useApi(teamsFetcher);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !teamId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await demandsApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        teamId,
        input: input.trim() || undefined,
      });
      
      // Reset form
      setTitle("");
      setDescription("");
      setPriority("medium");
      setTeamId("");
      setInput("");
      
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setIsSubmitting(false);
    }
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
      <div className="relative bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white">Create Task</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white 
                       placeholder-gray-500 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details about the task..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white 
                       placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          {/* Team */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Team *
            </label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white 
                       focus:outline-none focus:border-amber-500"
              required
            >
              <option value="">Select a team...</option>
              {teams?.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.emoji} {team.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Priority
            </label>
            <div className="flex gap-2">
              {(["low", "medium", "high"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={cn(
                    "flex-1 px-4 py-2 rounded-lg border font-medium capitalize transition-colors",
                    priority === p
                      ? p === "high"
                        ? "bg-red-500/20 border-red-500 text-red-400"
                        : p === "medium"
                        ? "bg-amber-500/20 border-amber-500 text-amber-400"
                        : "bg-gray-500/20 border-gray-500 text-gray-400"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Input */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Input Data
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Optional input data for the task..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white 
                       placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none font-mono text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white 
                       rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !teamId}
              className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-700 
                       disabled:text-gray-500 text-black font-medium rounded-lg transition-colors"
            >
              {isSubmitting ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
