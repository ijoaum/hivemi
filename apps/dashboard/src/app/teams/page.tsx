"use client";

import { useState, useCallback, useMemo } from "react";
import { TeamCard } from "@/components/team-card";
import { TeamModal, type TeamFormData } from "@/components/team-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useApi } from "@/hooks/use-api";
import { teamsApi, agentsApi } from "@/lib/api";
import type { Team } from "@/lib/api";

export default function TeamsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<(TeamFormData & { id: string }) | undefined>();
  const [deletingTeam, setDeletingTeam] = useState<{ id: string; name: string } | null>(null);

  // Fetch from API
  const teamsFetcher = useCallback(() => teamsApi.list(), []);
  const agentsFetcher = useCallback(() => agentsApi.list(), []);

  const { data: apiTeams, error: teamsError, refetch: refetchTeams } = useApi(teamsFetcher);
  const { data: apiAgents } = useApi(agentsFetcher);

  // Build teams with agent counts
  const teams = useMemo(() => {
    if (teamsError || !apiTeams?.length) return [];
    return apiTeams;
  }, [apiTeams, teamsError]);

  const getAgentCount = useCallback((teamId: string) => {
    return apiAgents?.filter(a => a.teamId === teamId).length || 0;
  }, [apiAgents]);

  const totalAgents = useMemo(() => {
    return teams.reduce((sum, t) => sum + getAgentCount(t.id), 0);
  }, [teams, getAgentCount]);

  const activeTeams = useMemo(() => {
    return teams.filter(t => getAgentCount(t.id) > 0).length;
  }, [teams, getAgentCount]);

  const handleCreate = async (data: TeamFormData) => {
    await teamsApi.create(data);
    refetchTeams();
  };

  const handleEdit = async (data: TeamFormData) => {
    if (!editingTeam) return;
    await teamsApi.update(editingTeam.id, data);
    refetchTeams();
  };

  const handleDelete = async () => {
    if (!deletingTeam) return;
    await teamsApi.delete(deletingTeam.id);
    refetchTeams();
  };

  const openEditModal = (team: Team) => {
    setEditingTeam({
      id: team.id,
      name: team.name,
      emoji: team.emoji,
      color: team.color,
    });
    setIsModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingTeam(undefined);
    setIsModalOpen(true);
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Teams</h1>
          <p className="text-sm md:text-base text-gray-400">
            Organize agents into collaborative squads
            {teamsError && <span className="text-amber-500 ml-2">(API unavailable)</span>}
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="px-3 md:px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          <span>+</span>
          <span className="hidden sm:inline">New Team</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-white">{teams.length}</div>
          <div className="text-xs md:text-sm text-gray-500">Total Teams</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-green-400">{activeTeams}</div>
          <div className="text-xs md:text-sm text-gray-500">Active</div>
        </div>
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 md:p-4">
          <div className="text-xl md:text-2xl font-bold text-amber-400">{totalAgents}</div>
          <div className="text-xs md:text-sm text-gray-500">Agents</div>
        </div>
      </div>

      {/* Empty state */}
      {teams.length === 0 && !teamsError && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-2">No teams yet</p>
          <p className="text-sm">Create your first team to organize your agents</p>
        </div>
      )}

      {/* Teams grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            agentCount={getAgentCount(team.id)}
            onEdit={() => openEditModal(team)}
            onDelete={() => setDeletingTeam({ id: team.id, name: team.name })}
          />
        ))}
      </div>

      {/* Create/Edit Modal */}
      <TeamModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingTeam(undefined); }}
        onSave={editingTeam ? handleEdit : handleCreate}
        team={editingTeam}
        mode={editingTeam ? "edit" : "create"}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deletingTeam}
        onClose={() => setDeletingTeam(null)}
        onConfirm={handleDelete}
        title="Delete Team"
        message={`Are you sure you want to delete "${deletingTeam?.name}"? Agents in this team will need to be reassigned.`}
        confirmLabel="Delete"
        isDestructive
      />
    </>
  );
}
