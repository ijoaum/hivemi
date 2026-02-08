"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, Loader2, Rocket, ChevronDown, CheckCircle, AlertCircle, Dices } from "lucide-react";
import { RoleIcon } from "./role-icon";

const agentNames = [
  "Atlas", "Nova", "Orion", "Cipher", "Vega", "Flux", "Echo", "Pixel",
  "Helix", "Nexus", "Prism", "Quark", "Rune", "Spark", "Zenith", "Blaze",
  "Cobalt", "Drift", "Ember", "Fable", "Glyph", "Haze", "Ivy", "Jinx",
  "Kite", "Lumen", "Mako", "Nyx", "Onyx", "Pulse", "Quinn", "Raven",
  "Sage", "Thorn", "Unity", "Volt", "Wren", "Xeno", "Yara", "Zephyr",
  "Aegis", "Binary", "Crux", "Delta", "Ether", "Forge", "Ghost", "Hex",
  "Ion", "Jade", "Knox", "Lyric", "Mist", "Nimbus", "Opal", "Pyre",
  "Quill", "Rift", "Shard", "Trace", "Umbra", "Viper", "Wraith", "Axiom",
];

function generateRandomName(): string {
  return agentNames[Math.floor(Math.random() * agentNames.length)];
}

interface Role {
  id: string;
  name: string;
  icon: string;
  description: string;
}

interface Team {
  id: string;
  name: string;
  emoji: string;
}

interface DeployAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (data: DeployAgentData) => Promise<void>;
  roles: Role[];
  teams: Team[];
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

type DeployState = "idle" | "deploying" | "success" | "error";

export function DeployAgentModal({ isOpen, onClose, onDeploy, roles, teams }: DeployAgentModalProps) {
  const [name, setName] = useState(generateRandomName);
  const [roleId, setRoleId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [autoStart, setAutoStart] = useState(true);
  const [deployState, setDeployState] = useState<DeployState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  // Set defaults when roles/teams load
  useEffect(() => {
    if (roles.length && !roleId) setRoleId(roles[0].id);
  }, [roles, roleId]);

  useEffect(() => {
    if (teams.length && !teamId) setTeamId(teams[0].id);
  }, [teams, teamId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(event.target as Node)) {
        setRoleDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setDeployState("idle");
      setErrorMessage("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeployState("deploying");
    setErrorMessage("");
    
    try {
      await onDeploy({ name, roleId, teamId, model, autoStart });
      setDeployState("success");
      // Auto-close after success
      setTimeout(() => {
        setName(generateRandomName());
        setDeployState("idle");
        onClose();
      }, 1500);
    } catch (err) {
      setDeployState("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to deploy agent");
    }
  };

  const selectedRole = roles.find((r) => r.id === roleId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={deployState === "deploying" ? undefined : onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Success overlay */}
        {deployState === "success" && (
          <div className="absolute inset-0 z-20 bg-gray-900/95 flex flex-col items-center justify-center gap-4">
            <CheckCircle className="w-16 h-16 text-green-400 animate-bounce" />
            <p className="text-xl font-semibold text-white">Agent Deployed!</p>
            <p className="text-gray-400">{name} is ready to work ⬡</p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-xl font-semibold text-white">Deploy New Agent</h2>
          <button
            onClick={onClose}
            disabled={deployState === "deploying"}
            className="text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Error banner */}
          {deployState === "error" && (
            <div className="flex items-center gap-3 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-300">{errorMessage}</p>
            </div>
          )}

          {/* Agent Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Agent Name</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Atlas, Nova..."
                required
                disabled={deployState === "deploying"}
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setName(generateRandomName())}
                disabled={deployState === "deploying"}
                title="Generate random name"
                className="px-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-amber-400 hover:border-amber-500 transition-colors disabled:opacity-50"
              >
                <Dices className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Role */}
          <div className="relative" ref={roleDropdownRef}>
            <label className="block text-sm text-gray-400 mb-2">Role</label>
            <button
              type="button"
              onClick={() => deployState !== "deploying" && setRoleDropdownOpen(!roleDropdownOpen)}
              disabled={deployState === "deploying"}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors flex items-center justify-between disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <RoleIcon icon={selectedRole?.icon || "bot"} className="w-5 h-5" />
                <span>{selectedRole?.name || "Select a role"}</span>
              </div>
              <ChevronDown className={cn("w-4 h-4 transition-transform", roleDropdownOpen && "rotate-180")} />
            </button>
            
            {roleDropdownOpen && (
              <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                {roles.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => {
                      setRoleId(role.id);
                      setRoleDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-700 transition-colors text-left",
                      roleId === role.id ? "bg-amber-500/20 text-amber-400" : "text-gray-300"
                    )}
                  >
                    <RoleIcon icon={role.icon} className="w-5 h-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{role.name}</p>
                      <p className="text-xs text-gray-500 truncate">{role.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Team */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Team</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              disabled={deployState === "deploying"}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
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
                  onClick={() => deployState !== "deploying" && setModel(m.id)}
                  disabled={deployState === "deploying"}
                  className={cn(
                    "p-3 rounded-lg border text-left transition-all",
                    model === m.id
                      ? "bg-amber-500/20 border-amber-500 text-white"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600",
                    deployState === "deploying" && "opacity-50"
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
              onClick={() => deployState !== "deploying" && setAutoStart(!autoStart)}
              disabled={deployState === "deploying"}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors",
                autoStart ? "bg-amber-500" : "bg-gray-600",
                deployState === "deploying" && "opacity-50"
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
              disabled={deployState === "deploying"}
              className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name || !roleId || !teamId || deployState === "deploying"}
              className={cn(
                "flex-1 px-4 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                name && roleId && teamId && deployState !== "deploying"
                  ? "bg-amber-500 hover:bg-amber-600 text-black"
                  : "bg-gray-700 text-gray-500 cursor-not-allowed"
              )}
            >
              {deployState === "deploying" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4" /> Deploy Agent
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
