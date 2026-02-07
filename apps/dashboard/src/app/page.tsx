"use client";

import { useState, useCallback, useMemo } from "react";
import { AgentCard } from "@/components/agent-card";
import { StatusBar } from "@/components/status-bar";
import { Sidebar } from "@/components/sidebar";
import { DeployAgentModal } from "@/components/deploy-agent-modal";
import { useApi } from "@/hooks/use-api";
import { agentsApi, teamsApi, rolesApi, statusApi, type Agent, type Team, type Role } from "@/lib/api";
import { mockAgents, getAgentsByTeam } from "@/data/mock-agents";
import { teams as mockTeams, TeamId } from "@/types/agent";
import { cn } from "@/lib/utils";

const teamColors: Record<string, string> = {
  amber: "border-amber-300 dark:border-amber-700 bg-gradient-to-br from-white via-amber-50 to-amber-100 dark:from-amber-900/40 dark:via-amber-950/30 dark:to-amber-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
  blue: "border-blue-300 dark:border-blue-700 bg-gradient-to-br from-white via-blue-50 to-blue-100 dark:from-blue-900/40 dark:via-blue-950/30 dark:to-blue-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[intml_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
  green: "border-green-300 dark:border-green-700 bg-gradient-to-br from-white via-green-50 to-green-100 dark:from-green-900/40 dark:via-green-950/30 dark:to-green-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
  purple: "border-purple-300 dark:border-purple-700 bg-gradient-to-br from-white via-purple-50 to-purple-100 dark:from-purple-900/40 dark:via-purple-950/30 dark:to-purple-900/20 shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.8),inset_0_-1px_2px_0_rgba(0,0,0,0.05),0_4px_12px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_2px_4px_0_rgba(255,255,255,0.15),inset_0_-1px_2px_0_rgba(0,0,0,0.2),0_4px_12px_0_rgba(0,0,0,0.3)]",
};

const teamHeaderColors: Record<string, string> = {
  amber: "text-amber-700 dark:text-amber-400",
  blue: "text-blue-700 dark:text-blue-400",
  green: "text-green-700 dark:text-green-400",
  purple: "text-purple-700 dark:text-purple-400",
};

export default function Home() {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [useMockData, setUseMockData] = useState(true); // Fallback to mock data
  
  // Fetch from API with auto-refresh every 5 seconds
  const agentsFetcher = useCallback(() => agentsApi.list(), []);
  const teamsFetcher = useCallback(() => teamsApi.list(), []);
  const rolesFetcher = useCallback(() => rolesApi.list(), []);
  const statusFetcher = useCallback(() => statusApi.get(), []);
  
  const { data: apiAgents, error: agentsError } = useApi(agentsFetcher, { refetchInterval: 5000 });
  const { data: apiTeams, error: teamsError } = useApi(teamsFetcher, { refetchInterval: 30000 });
  const { data: apiRoles } = useApi(rolesFetcher, { refetchInterval: 30000 });
  const { data: apiStatus } = useApi(statusFetcher, { refetchInterval: 5000 });

  // Fall back to mock data if API fails
  const agents = useMemo(() => {
    if (agentsError || !apiAgents?.length) return mockAgents;
    // Convert API agents to display format
    return apiAgents.map(a => ({
      id: a.id,
      name: a.name,
      role: apiRoles?.find(r => r.id === a.roleId)?.slug || "unknown",
      teamId: a.teamId,
      status: a.status,
      currentTask: a.currentTaskId ? "Processing..." : undefined,
      progress: a.status === "working" ? 50 : undefined,
      tasksToday: 0, // Would need separate endpoint
      model: a.model,
    }));
  }, [apiAgents, apiRoles, agentsError]);

  const teams = useMemo(() => {
    if (teamsError || !apiTeams?.length) return mockTeams;
    return apiTeams;
  }, [apiTeams, teamsError]);

  const getTeamAgents = (teamId: string) => {
    if (agentsError || !apiAgents?.length) return getAgentsByTeam(teamId as TeamId);
    return agents.filter(a => (a as { teamId?: string; team?: string }).teamId === teamId || (a as { team?: string }).team === teamId);
  };

  const handleDeploy = async (data: { name: string; roleId: string; teamId: string; model: string; autoStart: boolean }) => {
    console.log("Deploying agent:", data);
    try {
      await agentsApi.create({
        name: data.name,
        roleId: data.roleId,
        teamId: data.teamId,
        model: data.model,
        host: "http://localhost",
        port: 3001 + Math.floor(Math.random() * 100),
        status: data.autoStart ? "idle" : "offline",
      });
      setIsDeployModalOpen(false);
    } catch (err) {
      console.error("Failed to deploy agent:", err);
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-950">
      <Sidebar />
      
      <main className="flex-1 p-8 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              The Hive 🐝
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Your agent squad, working in real-time
              {agentsError && <span className="text-amber-500 ml-2">(using mock data)</span>}
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <StatusBar agents={agents as any} />
            
            <button 
              onClick={() => setIsDeployModalOpen(true)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white 
                             font-medium rounded-lg transition-colors flex items-center gap-2">
              <span>+</span>
              Deploy Agent
            </button>
          </div>
        </div>

        {/* Teams Grid */}
        <div className="space-y-8">
          {teams.map((team) => {
            const teamAgents = getTeamAgents(team.id);
            const workingCount = teamAgents.filter(a => a.status === "working").length;
            
            return (
              <div key={team.id}>
                {/* Team Header */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">{team.emoji}</span>
                  <h2 className={cn("text-xl font-bold", teamHeaderColors[team.color] || "text-gray-700")}>
                    {team.name}
                  </h2>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {workingCount}/{teamAgents.length} working
                  </span>
                </div>
                
                {/* Team Agents Grid */}
                <div className={cn(
                  "rounded-xl border p-4",
                  teamColors[team.color] || teamColors.amber
                )}>
                  {teamAgents.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
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
                    <div className="text-center py-8 text-gray-500">
                      No agents in this team yet
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick Stats */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Agents</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
              {apiStatus?.agents.total || agents.length}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Working</p>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">
              {apiStatus?.agents.working || agents.filter(a => a.status === "working").length}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Idle</p>
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {apiStatus?.agents.idle || agents.filter(a => a.status === "idle").length}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-600 dark:text-gray-400">Active Teams</p>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">
              {apiStatus?.teams || teams.length}
            </p>
          </div>
        </div>
      </main>

      {/* Deploy Modal */}
      <DeployAgentModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        onDeploy={handleDeploy}
      />
    </div>
  );
}
