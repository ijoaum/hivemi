"use client";

import { useState, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/use-api";
import {
  infraApi,
  cloudApi,
  type ReconciliationReport,
  type CostReport,
  type CloudConfig,
  type CloudRegion,
  type CloudTestResult,
} from "@/lib/api";
import { 
  Settings, 
  Users, 
  Brain, 
  KeyRound, 
  Bell, 
  AlertTriangle,
  Server,
  Cloud,
  Check,
  X,
  Loader2,
  Copy,
  RefreshCw,
  Upload,
  Cpu,
  MemoryStick,
  DollarSign,
  type LucideIcon
} from "lucide-react";

interface SettingSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

const sections: SettingSection[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "cloud", label: "Cloud", icon: Cloud },
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
          {activeSection === "cloud" && <CloudSettings />}
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

function CloudSettings() {
  // State
  const [provider, setProvider] = useState<"digitalocean" | "gcp">("digitalocean");
  const [region, setRegion] = useState("nyc1");
  const [instanceSize, setInstanceSize] = useState<"small" | "medium" | "large">("small");
  const [apiToken, setApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [hasSSHKey, setHasSSHKey] = useState(false);
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [uploadedKey, setUploadedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<CloudTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Fetch existing config
  const configFetcher = useCallback(() => cloudApi.get(), []);
  const { data: config, loading: configLoading } = useApi<CloudConfig>(configFetcher, { cacheKey: "cloud-config" });

  // Fetch regions
  const regionsFetcher = useCallback(() => cloudApi.regions(), []);
  const { data: regions, loading: regionsLoading } = useApi<CloudRegion[]>(regionsFetcher, { cacheKey: "cloud-regions" });

  // Sync state from loaded config
  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setRegion(config.region);
      setInstanceSize(config.instanceSize);
      setHasExistingToken(config.hasApiToken);
      setHasSSHKey(config.hasSSHKey);
    }
  }, [config]);

  // Size definitions with specs
  const sizes = {
    small: { label: "Small", vcpu: 1, ram: "1 GB", cost: 6 },
    medium: { label: "Medium", vcpu: 2, ram: "2 GB", cost: 12 },
    large: { label: "Large", vcpu: 2, ram: "4 GB", cost: 24 },
  };

  // GCP sizes (approximate)
  const gcpSizes = {
    small: { label: "Small", vcpu: 1, ram: "1.7 GB", cost: 7 },
    medium: { label: "Medium", vcpu: 2, ram: "4 GB", cost: 17 },
    large: { label: "Large", vcpu: 4, ram: "8 GB", cost: 34 },
  };

  const currentSizes = provider === "digitalocean" ? sizes : gcpSizes;

  // Save handler
  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const payload: {
        provider: string;
        region: string;
        instanceSize: string;
        apiToken?: string;
        sshPublicKey?: string;
      } = {
        provider,
        region,
        instanceSize,
      };
      if (apiToken) {
        payload.apiToken = apiToken;
      }
      if (uploadedKey) {
        payload.sshPublicKey = uploadedKey;
      }
      await cloudApi.update(payload);
      setSaveStatus("success");
      setHasExistingToken(!!apiToken || hasExistingToken);
      if (apiToken) setApiToken(""); // Clear after save
      if (uploadedKey) {
        setHasSSHKey(true);
        setUploadedKey("");
      }
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  };

  // Test connection handler
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await cloudApi.test();
      setTestResult(result);
    } catch {
      setTestResult({ valid: false, error: "Request failed" });
    } finally {
      setTesting(false);
    }
  };

  // Generate SSH key handler
  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const result = await cloudApi.generateSSHKey();
      setSshPublicKey(result.publicKey);
      setHasSSHKey(true);
    } catch {
      // silent fail — user will see no key generated
    } finally {
      setGeneratingKey(false);
    }
  };

  // Copy SSH key
  const handleCopyKey = async () => {
    if (sshPublicKey) {
      await navigator.clipboard.writeText(sshPublicKey);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // Handle SSH key file upload
  const handleKeyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content && content.startsWith("ssh-")) {
        setUploadedKey(content.trim());
      }
    };
    reader.readAsText(file);
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    );
  }

  return (
    <>
      {/* Provider Selection */}
      <SettingCard title="Cloud Provider" description="Select the cloud provider for agent VMs">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setProvider("digitalocean"); setRegion("nyc1"); }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                provider === "digitalocean"
                  ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                  : "border-gray-700 bg-gray-900/50 hover:border-gray-600"
              )}
            >
              <span className="text-2xl">🔵</span>
              <div>
                <p className="text-sm font-medium text-white">DigitalOcean</p>
                <p className="text-xs text-gray-500">Droplets</p>
              </div>
            </button>
            <button
              onClick={() => { setProvider("gcp"); setRegion("us-central1"); }}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                provider === "gcp"
                  ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                  : "border-gray-700 bg-gray-900/50 hover:border-gray-600"
              )}
            >
              <span className="text-2xl">☁️</span>
              <div>
                <p className="text-sm font-medium text-white">Google Cloud</p>
                <p className="text-xs text-gray-500">Compute Engine</p>
              </div>
            </button>
          </div>
        </div>
      </SettingCard>

      {/* Region Selection */}
      <SettingCard title="Region" description="Choose the datacenter region for agent VMs">
        {regionsLoading ? (
          <div className="text-sm text-gray-500 animate-pulse">Loading regions...</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
            {(regions || []).map((r) => (
              <button
                key={r.slug}
                onClick={() => setRegion(r.slug)}
                disabled={!r.available}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg border text-left transition-all text-sm",
                  region === r.slug
                    ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                    : r.available
                      ? "border-gray-700/50 bg-gray-900/30 hover:border-gray-600"
                      : "border-gray-800 bg-gray-900/20 opacity-40 cursor-not-allowed"
                )}
              >
                <span className="text-base flex-shrink-0">{r.flag}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white truncate">{r.name}</p>
                  <p className="text-[10px] text-gray-500">{r.slug}</p>
                </div>
              </button>
            ))}
            {(!regions || regions.length === 0) && (
              <p className="text-xs text-gray-500 col-span-full">
                {provider === "gcp" 
                  ? "GCP regions not yet available" 
                  : "Configure API token to load available regions"}
              </p>
            )}
          </div>
        )}
      </SettingCard>

      {/* Instance Size */}
      <SettingCard title="Instance Size" description="Select default VM size for new agent deployments">
        <div className="grid grid-cols-3 gap-3">
          {(Object.entries(currentSizes) as [string, { label: string; vcpu: number; ram: string; cost: number }][]).map(
            ([key, spec]) => (
              <button
                key={key}
                onClick={() => setInstanceSize(key as "small" | "medium" | "large")}
                className={cn(
                  "flex flex-col items-center p-3 md:p-4 rounded-lg border transition-all",
                  instanceSize === key
                    ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                    : "border-gray-700 bg-gray-900/50 hover:border-gray-600"
                )}
              >
                <p className="text-sm font-medium text-white mb-2">{spec.label}</p>
                <div className="space-y-1 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Cpu className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-400">{spec.vcpu} vCPU</span>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <MemoryStick className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-400">{spec.ram}</span>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <DollarSign className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-amber-400 font-medium">${spec.cost}/mo</span>
                  </div>
                </div>
              </button>
            )
          )}
        </div>
      </SettingCard>

      {/* API Token */}
      <SettingCard 
        title="API Token" 
        description={`${provider === "digitalocean" ? "DigitalOcean" : "Google Cloud"} API token for provisioning VMs`}
      >
        <div className="space-y-3">
          {hasExistingToken && !apiToken && (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <Check className="w-3.5 h-3.5" />
              <span>Token configured</span>
            </div>
          )}
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={hasExistingToken ? "••••••••••••••••••••••••" : "Enter API token..."}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 md:px-4 py-2 pr-20 text-white focus:outline-none focus:border-amber-500 text-sm font-mono"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
            >
              {showToken ? "Hide" : "Show"}
            </button>
          </div>
          <p className="text-[11px] text-gray-600">
            {provider === "digitalocean" 
              ? "Generate at DigitalOcean → API → Tokens. Requires read+write scope." 
              : "Create a service account key in GCP Console → IAM → Service Accounts."}
          </p>
        </div>
      </SettingCard>

      {/* SSH Key */}
      <SettingCard title="SSH Key" description="SSH key used for bootstrapping agent VMs">
        <div className="space-y-3">
          {hasSSHKey && (
            <div className="flex items-center gap-2 text-xs text-green-400">
              <Check className="w-3.5 h-3.5" />
              <span>SSH key configured</span>
            </div>
          )}

          {sshPublicKey && (
            <div className="relative">
              <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-[11px] text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-20">
                {sshPublicKey}
              </pre>
              <button
                onClick={handleCopyKey}
                className="absolute top-2 right-2 p-1.5 rounded bg-gray-800 hover:bg-gray-700 transition-colors"
                title="Copy public key"
              >
                {copySuccess ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleGenerateKey}
              disabled={generatingKey}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-white transition-colors disabled:opacity-50"
            >
              {generatingKey ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Generate Key
            </button>
            <label className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-white transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Upload Public Key
              <input
                type="file"
                accept=".pub,.txt"
                onChange={handleKeyUpload}
                className="hidden"
              />
            </label>
          </div>

          {uploadedKey && (
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Check className="w-3.5 h-3.5" />
              <span>Key loaded — save to apply</span>
            </div>
          )}
        </div>
      </SettingCard>

      {/* Test Connection */}
      <SettingCard title="Test Connection" description="Validate your cloud provider credentials">
        <div className="space-y-3">
          <button
            onClick={handleTest}
            disabled={testing || (!hasExistingToken && !apiToken)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors w-full justify-center",
              testing || (!hasExistingToken && !apiToken)
                ? "bg-gray-800 text-gray-500 cursor-not-allowed"
                : "bg-amber-500/20 border border-amber-500/50 text-amber-400 hover:bg-amber-500/30"
            )}
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing connection...
              </>
            ) : (
              "Test Connection"
            )}
          </button>

          {testResult && (
            <div
              className={cn(
                "flex items-start gap-2 p-3 rounded-lg border text-sm",
                testResult.valid
                  ? "bg-green-500/10 border-green-500/30 text-green-300"
                  : "bg-red-500/10 border-red-500/30 text-red-300"
              )}
            >
              {testResult.valid ? (
                <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <X className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <div>
                {testResult.valid ? (
                  <>
                    <p className="font-medium">Connection successful</p>
                    {testResult.account && (
                      <p className="text-xs text-green-400/70 mt-1">
                        Account: {testResult.account} • Droplet limit: {testResult.dropletLimit}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-medium">Connection failed</p>
                    <p className="text-xs text-red-400/70 mt-1">{testResult.error}</p>
                  </>
                )}
              </div>
            </div>
          )}

          {!hasExistingToken && !apiToken && (
            <p className="text-xs text-gray-600">Configure an API token first to test the connection.</p>
          )}
        </div>
      </SettingCard>

      {/* Save Button */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className={cn(
            "flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-colors",
            saving
              ? "bg-amber-600/50 text-amber-200 cursor-wait"
              : "bg-amber-500 hover:bg-amber-600 text-black"
          )}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Configuration"
          )}
        </button>
        {saveStatus === "success" && (
          <span className="flex items-center gap-1 text-sm text-green-400">
            <Check className="w-4 h-4" />
            Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <X className="w-4 h-4" />
            Failed to save
          </span>
        )}
      </div>
    </>
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
