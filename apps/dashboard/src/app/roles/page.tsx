"use client";

import { useCallback, useMemo } from "react";
import { AppLayout } from "@/components/app-layout";
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
    <AppLayout>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Roles</h1>
          <p className="text-sm md:text-base text-gray-400">
            Define agent behaviors and capabilities
            {rolesError && <span className="text-amber-500 ml-2">(using mock data)</span>}
          </p>
        </div>
        <button className="px-3 md:px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg transition-colors flex items-center gap-2">
          <span>+</span>
          <span className="hidden sm:inline">New Role</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-white">{roles.length}</div>
          <div className="text-xs md:text-sm text-gray-500">Total Roles</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-green-400">{activeRoles}</div>
          <div className="text-xs md:text-sm text-gray-500">Active</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-amber-400">{totalAgents}</div>
          <div className="text-xs md:text-sm text-gray-500">Agents</div>
        </div>
      </div>

      {/* Roles grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role as Role} />
        ))}
      </div>
    </AppLayout>
  );
}
