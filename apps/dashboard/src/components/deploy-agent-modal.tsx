"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  X,
  Loader2,
  Rocket,
  ChevronDown,
  CheckCircle,
  AlertCircle,
  Dices,
  Circle,
  RotateCcw,
  Trash2,
  ExternalLink,
  Clock,
} from "lucide-react";
import { RoleIcon } from "./role-icon";
import { useDeployStream, type DeployPhase } from "@/hooks/use-deploy-stream";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const PHASE_LABELS: Record<string, string> = {
  provisioning: "Provisioning VM",
  installing: "Installing Dependencies",
  configuring: "Configuring Agent",
  registering: "Registering in Hive",
  ready: "Ready",
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  provisioning: "Creating virtual machine on cloud provider",
  installing: "Installing OpenClaw, Node.js, and daemon",
  configuring: "Injecting secrets and role configuration",
  registering: "Daemon booting and registering with the Hive",
  ready: "Agent is online and ready to work",
};

const models = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "claude-opus-4", name: "Claude Opus 4", provider: "Anthropic" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface DeployAgentData {
  name: string;
  roleId: string;
  teamId: string;
  model: string;
  autoStart: boolean;
}

interface DeployAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (data: DeployAgentData) => Promise<{ deployId: string; agentId: string }>;
  onRetry?: (deployId: string) => Promise<void>;
  onDestroy?: (deployId: string) => Promise<void>;
  roles: Role[];
  teams: Team[];
  /** If set, opens the modal directly into the stepper for an in-progress deploy */
  activeDeployId?: string | null;
}

type ModalView = "form" | "stepper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phaseDuration(phase: DeployPhase): string | null {
  if (!phase.startedAt) return null;
  const start = new Date(phase.startedAt).getTime();
  const end = phase.completedAt ? new Date(phase.completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

// ---------------------------------------------------------------------------
// Phase Stepper
// ---------------------------------------------------------------------------

function PhaseStepper({ phases }: { phases: DeployPhase[] }) {
  // Live timer tick for active phases
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasActive = phases.some((p) => p.status === "active");
    if (!hasActive) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [phases]);

  return (
    <div className="space-y-0">
      {phases.map((phase, i) => {
        const isLast = i === phases.length - 1;
        const duration = phaseDuration(phase);

        return (
          <div key={phase.name} className="flex gap-3">
            {/* Connector line + icon */}
            <div className="flex flex-col items-center">
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5">
                {phase.status === "completed" && (
                  <CheckCircle className="w-5 h-5 text-green-400" />
                )}
                {phase.status === "active" && (
                  <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
                )}
                {phase.status === "failed" && (
                  <AlertCircle className="w-5 h-5 text-red-400" />
                )}
                {phase.status === "pending" && (
                  <Circle className="w-5 h-5 text-gray-600" />
                )}
              </div>
              {/* Line */}
              {!isLast && (
                <div
                  className={cn(
                    "w-px flex-1 min-h-[24px]",
                    phase.status === "completed" ? "bg-green-400/40" : "bg-gray-700",
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className={cn("pb-4", isLast && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-medium leading-5",
                  phase.status === "completed" && "text-green-400",
                  phase.status === "active" && "text-amber-400",
                  phase.status === "failed" && "text-red-400",
                  phase.status === "pending" && "text-gray-500",
                )}
              >
                {PHASE_LABELS[phase.name] || phase.name}
              </p>

              {/* Description for active phase */}
              {phase.status === "active" && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {PHASE_DESCRIPTIONS[phase.name] || "Processing..."}
                </p>
              )}

              {/* Error message */}
              {phase.error && (
                <p className="text-xs text-red-400 mt-0.5 break-all">{phase.error}</p>
              )}

              {/* Duration */}
              {duration && (phase.status === "completed" || phase.status === "active" || phase.status === "failed") && (
                <p className="text-xs text-gray-600 mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {duration}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast (persistent notification when modal is closed during deploy)
// ---------------------------------------------------------------------------

export function DeployToast({
  agentName,
  status,
  onReopen,
  onDismiss,
}: {
  agentName: string;
  status: "deploying" | "success" | "failed";
  onReopen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[280px]">
        {status === "deploying" && (
          <Loader2 className="w-5 h-5 text-amber-400 animate-spin flex-shrink-0" />
        )}
        {status === "success" && (
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
        )}
        {status === "failed" && (
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium truncate">
            {status === "deploying" && `Deploying ${agentName}...`}
            {status === "success" && `${agentName} deployed!`}
            {status === "failed" && `${agentName} deploy failed`}
          </p>
        </div>

        <button
          onClick={onReopen}
          className="text-xs text-amber-400 hover:text-amber-300 whitespace-nowrap"
        >
          {status === "deploying" ? "View" : "Details"}
        </button>

        {status !== "deploying" && (
          <button onClick={onDismiss} className="text-gray-500 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export function DeployAgentModal({
  isOpen,
  onClose,
  onDeploy,
  onRetry,
  onDestroy,
  roles,
  teams,
  activeDeployId,
}: DeployAgentModalProps) {
  // Form state
  const [name, setName] = useState(generateRandomName);
  const [roleId, setRoleId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [autoStart, setAutoStart] = useState(true);
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const roleDropdownRef = useRef<HTMLDivElement>(null);

  // Modal view
  const [view, setView] = useState<ModalView>("form");
  const [deployId, setDeployId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");

  // SSE stream
  const stream = useDeployStream();

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

  // If modal opens with an activeDeployId, go straight to stepper
  useEffect(() => {
    if (isOpen && activeDeployId) {
      setDeployId(activeDeployId);
      setView("stepper");
      stream.connect(activeDeployId);
    }
  }, [isOpen, activeDeployId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to form when modal opens without activeDeployId
  useEffect(() => {
    if (isOpen && !activeDeployId) {
      setView("form");
      setDeployId(null);
      stream.reset();
    }
  }, [isOpen, activeDeployId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await onDeploy({ name, roleId, teamId, model, autoStart });
      setDeployId(result.deployId);
      setAgentName(name);
      setView("stepper");
      // Start SSE stream
      stream.connect(result.deployId);
    } catch {
      // Error is handled by the caller
    }
  };

  const handleRetry = async () => {
    if (!deployId || !onRetry) return;
    stream.reset();
    await onRetry(deployId);
    stream.connect(deployId);
  };

  const handleDestroy = async () => {
    if (!deployId || !onDestroy) return;
    await onDestroy(deployId);
    onClose();
  };

  const handleViewAgent = () => {
    if (stream.agentId) {
      window.location.href = `/agents/${stream.agentId}`;
    }
  };

  const handleClose = useCallback(() => {
    // If deploy is in progress, just close (parent handles toast)
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  const isDeploying = view === "stepper" && !stream.finished;
  const isSuccess = view === "stepper" && stream.finished && stream.status === "ready";
  const isFailed = view === "stepper" && stream.finished && (stream.status === "failed" || !!stream.error);

  const selectedRole = roles.find((r) => r.id === roleId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={isDeploying ? undefined : handleClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
          <h2 className="text-xl font-semibold text-white">
            {view === "form" ? "Deploy New Agent" : `Deploying ${agentName || "Agent"}`}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ============================================================= */}
        {/* FORM VIEW */}
        {/* ============================================================= */}
        {view === "form" && (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
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
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setName(generateRandomName())}
                  title="Generate random name"
                  className="px-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-amber-400 hover:border-amber-500 transition-colors"
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
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <RoleIcon icon={selectedRole?.icon || "bot"} className="w-5 h-5" />
                  <span>{selectedRole?.name || "Select a role"}</span>
                </div>
                <ChevronDown
                  className={cn("w-4 h-4 transition-transform", roleDropdownOpen && "rotate-180")}
                />
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
                        roleId === role.id ? "bg-amber-500/20 text-amber-400" : "text-gray-300",
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
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
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
                    onClick={() => setModel(m.id)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all",
                      model === m.id
                        ? "bg-amber-500/20 border-amber-500 text-white"
                        : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600",
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
                  autoStart ? "bg-amber-500" : "bg-gray-600",
                )}
              >
                <span
                  className={cn(
                    "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform",
                    autoStart && "translate-x-5",
                  )}
                />
              </button>
            </label>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name || !roleId || !teamId}
                className={cn(
                  "flex-1 px-4 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                  name && roleId && teamId
                    ? "bg-amber-500 hover:bg-amber-600 text-black"
                    : "bg-gray-700 text-gray-500 cursor-not-allowed",
                )}
              >
                <Rocket className="w-4 h-4" /> Deploy Agent
              </button>
            </div>
          </form>
        )}

        {/* ============================================================= */}
        {/* STEPPER VIEW */}
        {/* ============================================================= */}
        {view === "stepper" && (
          <div className="p-6 space-y-6">
            {/* Status Header */}
            <div className="flex items-center gap-3">
              {isDeploying && (
                <>
                  <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
                  <div>
                    <p className="text-white font-medium">Deploying...</p>
                    <p className="text-xs text-gray-500">This may take a few minutes</p>
                  </div>
                </>
              )}
              {isSuccess && (
                <>
                  <CheckCircle className="w-6 h-6 text-green-400" />
                  <div>
                    <p className="text-green-400 font-medium">Deploy Complete!</p>
                    <p className="text-xs text-gray-500">{agentName} is ready to work ⬡</p>
                  </div>
                </>
              )}
              {isFailed && (
                <>
                  <AlertCircle className="w-6 h-6 text-red-400" />
                  <div>
                    <p className="text-red-400 font-medium">Deploy Failed</p>
                    <p className="text-xs text-gray-500">
                      {stream.error || "An error occurred during deployment"}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Phase Stepper */}
            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-800">
              <PhaseStepper phases={stream.phases} />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              {isFailed && (
                <>
                  {onRetry && (
                    <button
                      onClick={handleRetry}
                      className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-black rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" /> Retry
                    </button>
                  )}
                  {onDestroy && (
                    <button
                      onClick={handleDestroy}
                      className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" /> Destroy
                    </button>
                  )}
                </>
              )}

              {isSuccess && (
                <>
                  <button
                    onClick={handleClose}
                    className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleViewAgent}
                    className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-black rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" /> View Agent
                  </button>
                </>
              )}

              {isDeploying && (
                <button
                  onClick={handleClose}
                  className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-lg transition-colors text-sm"
                >
                  Close (deploy continues in background)
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
