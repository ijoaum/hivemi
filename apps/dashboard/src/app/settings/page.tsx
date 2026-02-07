"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { cn } from "@/lib/utils";

interface SettingSection {
  id: string;
  label: string;
  icon: string;
}

const sections: SettingSection[] = [
  { id: "general", label: "General", icon: "⚙️" },
  { id: "agents", label: "Agents", icon: "👥" },
  { id: "llm", label: "LLM Providers", icon: "🧠" },
  { id: "secrets", label: "Secrets", icon: "🔐" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "danger", label: "Danger Zone", icon: "⚠️" },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState("general");

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
          <p className="text-gray-400">Configure your HiveMI cluster</p>
        </div>

        <div className="flex gap-8">
          {/* Sections nav */}
          <nav className="w-48 flex-shrink-0">
            <ul className="space-y-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <button
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors",
                      activeSection === section.id
                        ? "bg-gray-800 text-white"
                        : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-300"
                    )}
                  >
                    <span>{section.icon}</span>
                    <span>{section.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Content */}
          <div className="flex-1 max-w-2xl">
            {activeSection === "general" && <GeneralSettings />}
            {activeSection === "agents" && <AgentSettings />}
            {activeSection === "llm" && <LLMSettings />}
            {activeSection === "secrets" && <SecretsSettings />}
            {activeSection === "notifications" && <NotificationSettings />}
            {activeSection === "danger" && <DangerZone />}
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-6 mb-4">
      <h3 className="text-lg font-medium text-white mb-1">{title}</h3>
      {description && <p className="text-sm text-gray-400 mb-4">{description}</p>}
      {children}
    </div>
  );
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-gray-300">{label}</span>
      <button
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative w-11 h-6 rounded-full transition-colors",
          enabled ? "bg-amber-500" : "bg-gray-600"
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform",
            enabled && "translate-x-5"
          )}
        />
      </button>
    </label>
  );
}

function GeneralSettings() {
  const [clusterName, setClusterName] = useState("local-dev");
  const [autoStart, setAutoStart] = useState(true);
  const [debugMode, setDebugMode] = useState(false);

  return (
    <>
      <SettingCard title="Cluster Configuration" description="Basic settings for your HiveMI cluster">
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Cluster Name</label>
            <input
              type="text"
              value={clusterName}
              onChange={(e) => setClusterName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Registry URL</label>
            <input
              type="text"
              value="http://localhost:4001"
              disabled
              className="w-full bg-gray-900/50 border border-gray-700 rounded-lg px-4 py-2 text-gray-500"
            />
          </div>
        </div>
      </SettingCard>

      <SettingCard title="Behavior">
        <div className="space-y-4">
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
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Max Concurrent Agents</label>
            <input
              type="number"
              value={maxAgents}
              onChange={(e) => setMaxAgents(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Heartbeat Interval (seconds)</label>
            <input
              type="number"
              value={heartbeatInterval}
              onChange={(e) => setHeartbeatInterval(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-2">Task Timeout (seconds)</label>
            <input
              type="number"
              value={taskTimeout}
              onChange={(e) => setTaskTimeout(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-amber-500"
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
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-amber-500"
        >
          <option value="openai">OpenAI (gpt-4o)</option>
          <option value="anthropic">Anthropic (claude-sonnet-4)</option>
        </select>
      </SettingCard>

      <SettingCard title="Configured Providers">
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700"
            >
              <div>
                <p className="text-white font-medium">{provider.name}</p>
                <p className="text-sm text-gray-500">{provider.model}</p>
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
        <div className="space-y-3">
          {secrets.map((secret) => (
            <div
              key={secret.name}
              className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700"
            >
              <div>
                <p className="text-white font-mono text-sm">{secret.name}</p>
                <p className="text-xs text-gray-500">
                  via {secret.source} • {secret.lastUpdated}
                </p>
              </div>
              <button className="text-xs text-amber-400 hover:text-amber-300">
                Rotate
              </button>
            </div>
          ))}
        </div>
        <button className="mt-4 w-full py-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors">
          + Add Secret
        </button>
      </SettingCard>

      <SettingCard title="1Password Integration">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white">Service Account</p>
            <p className="text-sm text-gray-500">Vault: Clawdia</p>
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
        <div className="space-y-4">
          <Toggle enabled={taskComplete} onChange={setTaskComplete} label="Task completed" />
          <Toggle enabled={taskFailed} onChange={setTaskFailed} label="Task failed" />
        </div>
      </SettingCard>

      <SettingCard title="Agent Notifications">
        <div className="space-y-4">
          <Toggle enabled={agentOffline} onChange={setAgentOffline} label="Agent went offline" />
        </div>
      </SettingCard>

      <SettingCard title="Digest">
        <div className="space-y-4">
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
        <p className="text-sm text-gray-400 mb-4">
          This will stop all agents and clear the task queue. Agent configurations will be preserved.
        </p>
        <button className="px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors">
          Reset Cluster
        </button>
      </SettingCard>

      <SettingCard title="Delete All Data">
        <p className="text-sm text-gray-400 mb-4">
          Permanently delete all agents, tasks, and logs. This action cannot be undone.
        </p>
        <button className="px-4 py-2 bg-red-500/20 border border-red-500/50 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors">
          Delete Everything
        </button>
      </SettingCard>
    </>
  );
}
