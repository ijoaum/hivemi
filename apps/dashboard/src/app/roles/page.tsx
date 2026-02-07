"use client";

import { Sidebar } from "@/components/sidebar";
import { RoleCard } from "@/components/role-card";
import { mockRoles } from "@/data/mock-roles";

export default function RolesPage() {
  const totalAgents = mockRoles.reduce((sum, role) => sum + role.agentCount, 0);
  const activeRoles = mockRoles.filter((r) => r.agentCount > 0).length;

  return (
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <main className="flex-1 p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Roles</h1>
            <p className="text-gray-400">Define agent behaviors and capabilities</p>
          </div>
          <button className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg transition-colors">
            + New Role
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-white">{mockRoles.length}</div>
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
          {mockRoles.map((role) => (
            <RoleCard key={role.id} role={role} />
          ))}
        </div>
      </main>
    </div>
  );
}
