"use client";

import { useState, useCallback, useMemo } from "react";
import { AgentCard } from "@/components/agent-card";
import { StatusBar } from "@/components/status-bar";
import { AppLayout } from "@/components/app-layout";
import { DeployAgentModal } from "@/components/deploy-agent-modal";
import { useApi } from "@/hooks/use-api";
import { agentsApi, teamsApi, rolesApi, type Agent, type Team, type Role } from "@/lib/api";
import { cn } from "@/lib/utils";

const teamColors: Record<string, string> = {
  amber: "border-amber-300 dark:border-amber-700 bg-gradient-to-br from-white via-amber-50 to-amber-100 dark:from-amber-900/40 dark:via-amber-950/30 dark:to-amber-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
  blue: "border-blue-300 dark:border-blue-700 bg-gradient-to-br from-white via-blue-50 to-blue-100 dark:from-blue-900/40 dark:via-blue-950/30 dark:to-blue-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
  green: "border-green-300 dark:border-green-700 bg-gradient-to-br from-white via-green-50 to-green-100 dark:from-green-900/40 dark:via-green-950/30 dark:to-green-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
  purple: "border-purple-300 dark:border-purple-700 bg-gradient-to-br from-white via-purple-50 to-purple-100 dark:from-purple-900/40 dark:via-purple-950/30 dark:to-purple-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
};

const teamHeaderColors: Record<string, string> = {
  amber: "text-amber-700 dark:text-amber-400",
  blue: "text-blue-700 dark:text-blue-400",
  green: "text-green-700 dark:text-green-400",
  purple: "text-purple-700 dark:text-purple-400",
};

// Loading skeleton for agent cards
function AgentCardSkeleton() {
  return (
    <div className="rounded-lg border p-4 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gray-300 dark:bg-gray-700 rounded" />
          <div>
            <div className="h-4 w-24 bg-gray-300 dark:bg-gray-700 rounded mb-1" />
            <div className="h-3 w-16 bg-gray-200 dark:bg-gray-800 rounded" />
          </div>
        </div>
        <div className="h-3 w-12 bg-gray-200 dark:bg-gray-800 rounded" />
      </div>
      <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded mb-3" />
      <div className="flex justify-between">
        <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
        <div className="h-3 w-12 bg-gray-200 dark:bg-gray-800 rounded" />
      </div>
    </div>
  );
}

// Loading skeleton for team section
function TeamSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 bg-gray-300 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-6 w-32 bg-gray-300 dark:bg-gray-700 rounded animate-pulse" />
      </div>
      <div className="rounded-xl border p-4 border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-900">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  
  // Fetch from API with auto-refresh every 5 seconds
  const agentsFetcher = useCallback(() => agentsApi.list(), []);
  const teamsFetcher = useCallback(() => teamsApi.list(), []);
  const rolesFetcher = useCallback(() => rolesApi.list(), []);
  
  const { data: apiAgents, loading: agentsLoading, refetch: refetchAgents } = useApi(agentsFetcher, { refetchInterval: 5000 });
  const { data: apiTeams, loading: teamsLoading } = useApi(teamsFetcher, { refetchInterval: 30000 });
  const { data: apiRoles } = useApi(rolesFetcher, { refetchInterval: 30000 });

  const isLoading = agentsLoading || teamsLoading;

  // Convert API agents to display format
  const agents = useMemo(() => {
    if (!apiAgents?.length) return [];
    return apiAgents.map(a => {
      return {
        id: a.id,
        name: a.name,
        role: a.role?.name || "Agent",
        roleIcon: a.role?.icon || "bot",
        team: a.teamId,
        teamId: a.teamId,
        status: a.status,
        currentTask: a.currentTaskId ? "Processing task..." : undefined,
        progress: a.status === "working" ? Math.floor(Math.random() * 60) + 20 : undefined,
        uptime: Math.floor(Math.random() * 28800) + 3600,
        tasksToday: Math.floor(Math.random() * 50) + 10,
        model: a.model,
      };
    });
  }, [apiAgents]);

  // Calculate stats from agents
  const stats = useMemo(() => ({
    total: agents.length,
    online: agents.filter(a => a.status !== "offline").length,
    working: agents.filter(a => a.status === "working").length,
    idle: agents.filter(a => a.status === "idle").length,
    error: agents.filter(a => a.status === "error").length,
  }), [agents]);

  const teams = useMemo(() => {
    if (!apiTeams?.length) return [];
    return apiTeams;
  }, [apiTeams]);

  const getTeamAgents = (teamId: string) => {
    return agents.filter(a => a.teamId === teamId);
  };

  const handleDeploy = async (data: { name: string; roleId: string; teamId: string; model: string; autoStart: boolean }) => {
    await agentsApi.create({
      name: data.name,
      roleId: data.roleId,
      teamId: data.teamId,
      model: data.model,
      host: "http://localhost",
      port: 3001 + Math.floor(Math.random() * 100),
      status: data.autoStart ? "idle" : "offline",
    });
    // Immediately refetch to show new agent
    await refetchAgents();
  };

  return (
    <AppLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
            The Hive 🐝
          </h1>
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mt-1">
            Your agent squad, working in real-time
          </p>
        </div>
        
        <div className="flex items-center gap-3 md:gap-4">
          {/* StatusBar - compact on mobile */}
          {!isLoading && (
            <div className="hidden sm:block">
              <StatusBar agents={agents as any} />
            </div>
          )}
          
          {/* Mobile stats - just numbers */}
          {!isLoading && (
            <div className="flex sm:hidden items-center gap-3 text-sm">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="font-medium">{stats.working}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="font-medium">{stats.idle}</span>
              </span>
              {stats.error > 0 && (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="font-medium text-red-600">{stats.error}</span>
                </span>
              )}
            </div>
          )}
          
          {/* Deploy button - icon only on mobile */}
          <button 
            onClick={() => setIsDeployModalOpen(true)}
            className="px-3 md:px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white 
                       font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <span className="text-lg">+</span>
            <span className="hidden sm:inline">Deploy Agent</span>
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-6 md:space-y-8">
          <TeamSkeleton />
          <TeamSkeleton />
          <TeamSkeleton />
        </div>
      )}

      {/* Teams Grid */}
      {!isLoading && (
        <div className="space-y-6 md:space-y-8">
          {teams.map((team) => {
            const teamAgents = getTeamAgents(team.id);
            const workingCount = teamAgents.filter(a => a.status === "working").length;
            
            return (
              <div key={team.id}>
                {/* Team Header */}
                <div className="flex items-center gap-2 md:gap-3 mb-3 md:mb-4">
                  <span className="text-xl md:text-2xl">{team.emoji}</span>
                  <h2 className={cn("text-lg md:text-xl font-bold", teamHeaderColors[team.color] || "text-gray-700")}>
                    {team.name}
                  </h2>
                  <span className="text-xs md:text-sm text-gray-500 dark:text-gray-400">
                    {workingCount}/{teamAgents.length}
                  </span>
                </div>
                
                {/* Team Agents Grid - 1 col mobile, 2 col tablet, 3+ desktop */}
                <div className={cn(
                  "rounded-xl border p-3 md:p-4",
                  teamColors[team.color] || teamColors.amber
                )}>
                  {teamAgents.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                      {teamAgents.map((agent) => (
                        <AgentCard
                          key={agent.id}
                          agent={agent as any}
                          onViewLogs={() => console.log("View logs:", agent.name)}
                          onConfigure={() => console.log("Configure:", agent.name)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 md:py-8 text-gray-500 text-sm md:text-base">
                      No agents in this team yet
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Stats - 2x2 on mobile, 4 cols on desktop */}
      <div className="mt-6 md:mt-8 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800">
          <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Total Agents</p>
          <p className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mt-1">
            {isLoading ? "..." : stats.total}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800">
          <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Working</p>
          <p className="text-2xl md:text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            {isLoading ? "..." : stats.working}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800">
          <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Idle</p>
          <p className="text-2xl md:text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {isLoading ? "..." : stats.idle}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800">
          <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Teams</p>
          <p className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mt-1">
            {isLoading ? "..." : teams.length}
          </p>
        </div>
      </div>

      {/* Deploy Modal */}
      <DeployAgentModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        onDeploy={handleDeploy}
        roles={apiRoles || []}
        teams={apiTeams || []}
      />
    </AppLayout>
  );
}
