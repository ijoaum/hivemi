"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { mockRoles } from "@/data/mock-roles";
import { teams } from "@/types/agent";

interface DeployAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (data: DeployAgentData) => void;
}

export interface DeployAgentData {
  name: string;
  roleId: string;
  teamId: string;
  model: string;
  autoStart: boolean;
}

const models = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "claude-opus-4", name: "Claude Opus 4", provider: "Anthropic" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
];

export function DeployAgentModal({ isOpen, onClose, onDeploy }: DeployAgentModalProps) {
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState(mockRoles[0]?.id || "");
  const [teamId, setTeamId] = useState<string>(teams[0]?.id || "");
  const [model, setModel] = useState("gpt-4o");
  const [autoStart, setAutoStart] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeploying(true);
    
    // Simulate deploy
    await new Promise((r) => setTimeout(r, 1500));
    
    onDeploy({ name, roleId, teamId, model, autoStart });
    setIsDeploying(false);
    setName("");
    onClose();
  };

  const selectedRole = mockRoles.find((r) => r.id === roleId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-xl font-semibold text-white">Deploy New Agent</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Agent Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Montgomery, Penelope..."
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Role</label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
            >
              {mockRoles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.icon} {role.name}
                </option>
              ))}
            </select>
            {selectedRole && (
              <p className="mt-2 text-xs text-gray-500">{selectedRole.description}</p>
            )}
          </div>

          {/* Team */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Team</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.emoji} {team.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">LLM Model</label>
            <div className="grid grid-cols-2 gap-2">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className={cn(
                    "p-3 rounded-lg border text-left transition-all",
                    model === m.id
                      ? "bg-amber-500/20 border-amber-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  )}
                >
                  <p className="font-medium text-sm">{m.name}</p>
                  <p className="text-xs text-gray-500">{m.provider}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-start */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-gray-300">Start agent immediately</span>
            <button
              type="button"
              onClick={() => setAutoStart(!autoStart)}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors",
                autoStart ? "bg-amber-500" : "bg-gray-600"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform",
                  autoStart && "translate-x-5"
                )}
              />
            </button>
          </label>

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
              disabled={!name || isDeploying}
              className={cn(
                "flex-1 px-4 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                name && !isDeploying
                  ? "bg-amber-500 hover:bg-amber-600 text-black"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              )}
            >
              {isDeploying ? (
                <>
                  <span className="animate-spin">⟳</span>
                  Deploying...
                </>
              ) : (
                <>
                  🚀 Deploy Agent
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
