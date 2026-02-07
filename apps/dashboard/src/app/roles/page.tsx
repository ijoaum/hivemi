"use client";

import { useCallback, useMemo } from "react";
import { Sidebar } from "@/components/sidebar";
import { RoleCard } from "@/components/role-card";
import { useApi } from "@/hooks/use-api";
import { rolesApi, agentsApi } from "@/lib/api";
import { mockRoles } from "@/data/mock-roles";
import type { Role } from "@/types/role";

export default function RolesPage() {
  // Fetch from API
  const rolesFetcher = useCallback(() => rolesApi.list(), []);
  const agentsFetcher = useCallback(() => agentsApi.list(), []);
  
  const { data: apiRoles, error: rolesError } = useApi(rolesFetcher);
  const { data: apiAgents } = useApi(agentsFetcher);

  // Convert API roles to display format or fall back to mock
  const roles = useMemo(() => {
    if (rolesError || !apiRoles?.length) {
      return mockRoles;
    }
    return apiRoles.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      icon: r.icon,
      color: r.color,
      capabilities: r.capabilities,
      systemPrompt: r.systemPrompt,
      agentCount: apiAgents?.filter(a => a.roleId === r.id).length || 0,
    }));
  }, [apiRoles, apiAgents, rolesError]);

  const totalAgents = useMemo(() => {
    return roles.reduce((sum, role) => sum + role.agentCount, 0);
  }, [roles]);

  const activeRoles = useMemo(() => {
    return roles.filter((r) => r.agentCount > 0).length;
  }, [roles]);

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Roles</h1>
            <p className="text-gray-400">
              Define agent behaviors and capabilities
              {rolesError && <span className="text-amber-500 ml-2">(using mock data)</span>}
            </p>
          </div>
          <button className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg transition-colors">
            + New Role
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-white">{roles.length}</div>
            <div className="text-sm text-gray-500">Total Roles</div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-400">{activeRoles}</div>
            <div className="text-sm text-gray-500">Active Roles</div>
          </div>
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-amber-400">{totalAgents}</div>
            <div className="text-sm text-gray-500">Total Agents</div>
          </div>
        </div>

        {/* Roles grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {roles.map((role) => (
            <RoleCard key={role.id} role={role as Role} />
          ))}
        </div>
      </main>
    </div>
  );
}
