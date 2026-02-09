"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";
import {
  infraApi,
  type ReconciliationReport,
  type CostReport,
} from "@/lib/api";
import { 
  Settings, 
  Users, 
  Brain, 
  KeyRound, 
  Bell, 
  AlertTriangle,
  Server,
  type LucideIcon
} from "lucide-react";

interface SettingSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

const sections: SettingSection[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "infra", label: "Infrastructure", icon: Server },
  { id: "agents", label: "Agents", icon: Users },
  { id: "llm", label: "LLM Providers", icon: Brain },
  { id: "secrets", label: "Secrets", icon: KeyRound },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "danger", label: "Danger Zone", icon: AlertTriangle },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("general");

  return (
    <>
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-sm md:text-base text-gray-400">Configure your HiveMI cluster</p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-8">
        {/* Sections nav - horizontal scroll on mobile, vertical on desktop */}
        <nav className="md:w-48 flex-shrink-0">
          <ul className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 md:space-y-1">
            {sections.map((section) => (
              <li key={section.id} className="flex-shrink-0">
                <button
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex items-center gap-2 md:gap-3 px-3 py-2 rounded-lg text-left transition-colors whitespace-nowrap text-sm md:text-base md:w-full",
                    activeSection === section.id
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-300"
                  )}
                >
                  <section.icon className="w-4 h-4 md:w-5 md:h-5" />
                  <span>{section.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {activeSection === "general" && <GeneralSettings />}
          {activeSection === "infra" && <InfraSettings />}
          {activeSection === "agents" && <AgentSettings />}
          {activeSection === "llm" && <LLMSettings />}
          {activeSection === "secrets" && <SecretsSettings />}
          {activeSection === "notifications" && <NotificationSettings />}
          {activeSection === "danger" && <DangerZone />}
        </div>
      </div>
    </>
  );
}

function SettingCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 md:p-6 mb-3 md:mb-4">
      <h3 className="text-base md:text-lg font-medium text-white mb-1">{title}</h3>
      {description && <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4">{description}</p>}
      {children}
    </div>
  );
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm md:text-base text-gray-300">{label}</span>
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative w-10 md:w-11 h-5 md:h-6 rounded-full transition-colors flex-shrink-0 ml-2",
          enabled ? "bg-amber-500" : "bg-gray-600"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 md:top-1 left-0.5 md:left-1 w-4 h-4 bg-white rounded-full transition-transform",
            enabled && "translate-x-5"
          )}
        />
      </button>
    </label>
  );
}

function InfraSettings() {
  const reconcileFetcher = useCallback(() => infraApi.reconcile(), []);
  const costsFetcher = useCallback(() => infraApi.costs(), []);

  const { data: reconciliation, loading: reconcileLoading, refetch: refetchReconcile } = useApi<ReconciliationReport>(reconcileFetcher, { cacheKey: "infra-reconcile" });
  const { data: costs, loading: costsLoading } = useApi<CostReport>(costsFetcher, { cacheKey: "infra-costs" });

  const statusColor = {
    clean: "text-green-400",
    warning: "text-amber-400",
    critical: "text-red-400",
  };

  const statusBg = {
    clean: "bg-green-500/20",
    warning: "bg-amber-500/20",
    critical: "bg-red-500/20",
  };

  return (
    <>
      {/* Reconciliation */}
      <SettingCard title="VM Reconciliation" description="Compare provider VMs against the registry to detect drift">
        {reconcileLoading ? (
          <div className="text-sm text-gray-500 animate-pulse">Running reconciliation...</div>
        ) : reconciliation ? (
          <div className="space-y-3 md:space-y-4">
            {/* Status badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn("text-xs px-2 py-1 rounded-full font-medium", statusBg[reconciliation.status], statusColor[reconciliation.status])}>
                  {reconciliation.status === "clean" ? "✓ Healthy" : reconciliation.status === "warning" ? "⚠ Issues" : "✗ Critical"}
                </span>
                <span className="text-xs text-gray-500">
                  {reconciliation.provider} • {new Date(reconciliation.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <button
                onClick={() => refetchReconcile()}
                className="text-xs text-amber-400 hover:text-amber-300"
              >
                Reconcile
              </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-gray-900/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-white">{reconciliation.stats.totalVMs}</p>
                <p className="text-xs text-gray-500">Total VMs</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-green-400">{reconciliation.stats.healthy}</p>
                <p className="text-xs text-gray-500">Healthy</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2 text-center">
                <p className={cn("text-lg font-bold", reconciliation.stats.orphaned > 0 ? "text-red-400" : "text-white")}>{reconciliation.stats.orphaned}</p>
                <p className="text-xs text-gray-500">Orphaned</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-2 text-center">
                <p className={cn("text-lg font-bold", reconciliation.stats.phantom > 0 ? "text-amber-400" : "text-white")}>{reconciliation.stats.phantom}</p>
                <p className="text-xs text-gray-500">Phantom</p>
              </div>
            </div>

            {/* Issues */}
            {reconciliation.issues.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 font-medium">Issues</p>
                {reconciliation.issues.map((issue, i) => (
                  <div key={i} className={cn("p-2 rounded-lg border text-xs", issue.severity === "error" ? "bg-red-500/10 border-red-500/30 text-red-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300")}>
                    <div className="flex items-start justify-between gap-2">
                      <span>{issue.message}</span>
                      {issue.type === "orphaned_vm" && issue.instanceId && (
                        <button
                          onClick={async () => {
                            if (confirm(`Destroy orphaned VM ${issue.instanceName || issue.instanceId}?`)) {
                              await infraApi.destroyOrphan(issue.instanceId!);
                              refetchReconcile();
                            }
                          }}
                          className="text-red-400 hover:text-red-300 whitespace-nowrap flex-shrink-0"
                        >
                          Destroy
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {reconciliation.issues.length === 0 && (
              <p className="text-xs text-gray-500">No inconsistencies detected.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Could not load reconciliation data. Is the cloud provider configured?</p>
        )}
      </SettingCard>

      {/* Costs */}
      <SettingCard title="Cost Estimation" description="Estimated infrastructure costs based on active VMs">
        {costsLoading ? (
          <div className="text-sm text-gray-500 animate-pulse">Calculating costs...</div>
        ) : costs ? (
          <div className="space-y-3 md:space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-white">${costs.monthly}</p>
                <p className="text-xs text-gray-500">Monthly</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-amber-400">${costs.projected}</p>
                <p className="text-xs text-gray-500">Projected</p>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-green-400">${costs.accumulated}</p>
                <p className="text-xs text-gray-500">Accumulated</p>
              </div>
            </div>

            {/* Breakdown */}
            {costs.breakdown.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-gray-400 font-medium">Per-Instance Breakdown</p>
                {costs.breakdown.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-gray-900/50 rounded-lg border border-gray-700">
                    <div>
                      <p className="text-sm text-white">{item.name}</p>
                      <p className="text-xs text-gray-500">{item.size} • {item.daysRunning}d running</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-white">${item.monthlyCostUsd}/mo</p>
                      <p className="text-xs text-gray-500">${item.accumulatedCostUsd} accrued</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {costs.breakdown.length === 0 && (
              <p className="text-xs text-gray-500">No active VMs. Deploy an agent to see cost estimates.</p>
            )}

            <p className="text-xs text-gray-600">
              Provider: {costs.provider} • Updated: {new Date(costs.generatedAt).toLocaleTimeString()}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Could not load cost data. Is the cloud provider configured?</p>
        )}
      </SettingCard>
    </>
  );
}

function GeneralSettings() {
  const [clusterName, setClusterName] = useState("local-dev");
  const [autoStart, setAutoStart] = useState(true);
  const [debugMode, setDebugMode] = useState(false);

  return (
    <>
      <SettingCard title="Cluster Configuration" description="Basic settings for your HiveMI cluster">
        <div className="space-y-3 md:space-y-4">
          <div>
            <label className="block text-xs md:text-sm text-gray-400 mb-1 md:mb-2">Cluster Name</label>
            <input
              type="text"
              value={clusterName}
              onChange={(e) => setClusterName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-amber-500 text-sm md:text-base"
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm text-gray-400 mb-1 md:mb-2">Registry URL</label>
            <input
              type="text"
              value="http://localhost:4001"
              disabled
              className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-gray-500 text-sm md:text-base"
            />
          </div>
        </div>
      </SettingCard>

      <SettingCard title="Behavior">
        <div className="space-y-3 md:space-y-4">
          <Toggle enabled={autoStart} onChange={setAutoStart} label="Auto-start agents on boot" />
          <Toggle enabled={debugMode} onChange={setDebugMode} label="Debug mode (verbose logging)" />
        </div>
      </SettingCard>
    </>
  );
}

function AgentSettings() {
  const [maxAgents, setMaxAgents] = useState("10");
  const [heartbeatInterval, setHeartbeatInterval] = useState("30");
  const [taskTimeout, setTaskTimeout] = useState("300");

  return (
    <>
      <SettingCard title="Agent Limits" description="Control agent resource usage">
        <div className="space-y-3 md:space-y-4">
          <div>
            <label className="block text-xs md:text-sm text-gray-400 mb-1 md:mb-2">Max Concurrent Agents</label>
            <input
              type="number"
              value={maxAgents}
              onChange={(e) => setMaxAgents(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-amber-500 text-sm md:text-base"
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm text-gray-400 mb-1 md:mb-2">Heartbeat Interval (seconds)</label>
            <input
              type="number"
              value={heartbeatInterval}
              onChange={(e) => setHeartbeatInterval(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-amber-500 text-sm md:text-base"
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm text-gray-400 mb-1 md:mb-2">Task Timeout (seconds)</label>
            <input
              type="number"
              value={taskTimeout}
              onChange={(e) => setTaskTimeout(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-amber-500 text-sm md:text-base"
            />
          </div>
        </div>
      </SettingCard>
    </>
  );
}

function LLMSettings() {
  const [defaultProvider, setDefaultProvider] = useState("openai");

  const providers = [
    { id: "openai", name: "OpenAI", status: "connected", model: "gpt-4o" },
    { id: "anthropic", name: "Anthropic", status: "connected", model: "claude-sonnet-4" },
    { id: "google", name: "Google", status: "not_configured", model: "-" },
  ];

  return (
    <>
      <SettingCard title="Default Provider">
        <select
          value={defaultProvider}
          onChange={(e) => setDefaultProvider(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 md:px-4 py-2 text-white focus:outline-none focus:border-amber-500 text-sm md:text-base"
        >
          <option value="openai">OpenAI (gpt-4o)</option>
          <option value="anthropic">Anthropic (claude-sonnet-4)</option>
        </select>
      </SettingCard>

      <SettingCard title="Configured Providers">
        <div className="space-y-2 md:space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between p-2 md:p-3 bg-gray-900/50 rounded-lg border border-gray-700"
            >
              <div>
                <p className="text-sm md:text-base text-white font-medium">{provider.name}</p>
                <p className="text-xs md:text-sm text-gray-500">{provider.model}</p>
              </div>
              <span
                className={cn(
                  "text-xs px-2 py-1 rounded-full",
                  provider.status === "connected"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-gray-500/20 text-gray-400"
                )}
              >
                {provider.status === "connected" ? "Connected" : "Not Configured"}
              </span>
            </div>
          ))}
        </div>
      </SettingCard>
    </>
  );
}

function SecretsSettings() {
  const secrets = [
    { name: "OPENAI_API_KEY", source: "1Password", lastUpdated: "2 days ago" },
    { name: "ANTHROPIC_API_KEY", source: "1Password", lastUpdated: "2 days ago" },
    { name: "GITHUB_TOKEN", source: "1Password", lastUpdated: "5 days ago" },
    { name: "DATABASE_URL", source: "Environment", lastUpdated: "-" },
  ];

  return (
    <>
      <SettingCard title="Secrets Manager" description="Manage API keys and sensitive credentials">
        <div className="space-y-2 md:space-y-3">
          {secrets.map((secret) => (
            <div
              key={secret.name}
              className="flex items-center justify-between p-2 md:p-3 bg-gray-900/50 rounded-lg border border-gray-700"
            >
              <div className="min-w-0 flex-1">
                <p className="text-white font-mono text-xs md:text-sm truncate">{secret.name}</p>
                <p className="text-xs text-gray-500">
                  via {secret.source} • {secret.lastUpdated}
                </p>
              </div>
              <button className="text-xs text-amber-400 hover:text-amber-300 ml-2 flex-shrink-0">
                Rotate
              </button>
            </div>
          ))}
        </div>
        <button className="mt-3 md:mt-4 w-full py-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors text-sm">
          + Add Secret
        </button>
      </SettingCard>

      <SettingCard title="1Password Integration">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm md:text-base text-white">Service Account</p>
            <p className="text-xs md:text-sm text-gray-500">Vault: Clawdia</p>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-400">
            Connected
          </span>
        </div>
      </SettingCard>
    </>
  );
}

function NotificationSettings() {
  const [taskComplete, setTaskComplete] = useState(true);
  const [taskFailed, setTaskFailed] = useState(true);
  const [agentOffline, setAgentOffline] = useState(true);
  const [dailyDigest, setDailyDigest] = useState(false);

  return (
    <>
      <SettingCard title="Task Notifications">
        <div className="space-y-3 md:space-y-4">
          <Toggle enabled={taskComplete} onChange={setTaskComplete} label="Task completed" />
          <Toggle enabled={taskFailed} onChange={setTaskFailed} label="Task failed" />
        </div>
      </SettingCard>

      <SettingCard title="Agent Notifications">
        <div className="space-y-3 md:space-y-4">
          <Toggle enabled={agentOffline} onChange={setAgentOffline} label="Agent went offline" />
        </div>
      </SettingCard>

      <SettingCard title="Digest">
        <div className="space-y-3 md:space-y-4">
          <Toggle enabled={dailyDigest} onChange={setDailyDigest} label="Daily summary email" />
        </div>
      </SettingCard>
    </>
  );
}

function DangerZone() {
  return (
    <>
      <SettingCard title="Reset Cluster">
        <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4">
          This will stop all agents and clear the task queue. Agent configurations will be preserved.
        </p>
        <button className="px-3 md:px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors text-sm md:text-base">
          Reset Cluster
        </button>
      </SettingCard>

      <SettingCard title="Delete All Data">
        <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4">
          Permanently delete all agents, tasks, and logs. This action cannot be undone.
        </p>
        <button className="px-3 md:px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors text-sm md:text-base">
          Delete Everything
        </button>
      </SettingCard>
    </>
  );
}
