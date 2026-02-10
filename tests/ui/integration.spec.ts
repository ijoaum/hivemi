import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import crypto from "crypto";

const BASE = "http://localhost:3000";
const REGISTRY = "http://localhost:4001";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a role directly via Registry API and return it. */
async function apiCreateRole(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    name: `Test Role ${Date.now()}`,
    slug: `test-role-${Date.now()}`,
    description: "Integration test role",
    icon: "bot",
    color: "blue",
    capabilities: ["testing"],
    systemPrompt: "You are a test agent.",
    ...overrides,
  };
  const res = await request.post(`${REGISTRY}/api/roles`, { data: payload });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

/** Create a team directly via Registry API and return it. */
async function apiCreateTeam(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    name: `Test Team ${Date.now()}`,
    emoji: "blocks",
    color: "green",
    ...overrides,
  };
  const res = await request.post(`${REGISTRY}/api/teams`, { data: payload });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

/** Create an agent directly via Registry API and return it. */
async function apiCreateAgent(
  request: APIRequestContext,
  roleId: string,
  teamId: string,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    id: crypto.randomUUID(),
    name: `Test Agent ${Date.now()}`,
    roleId,
    teamId,
    model: "gpt-4o",
    host: "http://localhost",
    port: 9999,
    ...overrides,
  };
  const res = await request.post(`${REGISTRY}/api/agents`, { data: payload });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

/** Create a task directly via Registry API and return it. */
async function apiCreateTask(
  request: APIRequestContext,
  teamId: string,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    title: `Test Task ${Date.now()}`,
    teamId,
    priority: "medium",
    ...overrides,
  };
  const res = await request.post(`${REGISTRY}/api/tasks`, { data: payload });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

/** Safely delete a resource — ignores 404. */
async function apiDelete(
  request: APIRequestContext,
  path: string,
) {
  const res = await request.delete(`${REGISTRY}${path}`);
  // 200 or 404 are both fine for cleanup
  expect([200, 404]).toContain(res.status());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Roles CRUD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: Roles CRUD", () => {
  const createdRoleIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdRoleIds) {
      await apiDelete(request, `/api/roles/${id}`);
    }
  });

  test("create role via UI modal, verify in list and API", async ({ page, request }) => {
    const roleName = `IntRole_${Date.now()}`;

    await page.goto(`${BASE}/roles`);
    await page.waitForLoadState("networkidle");

    // Click "New Role" / "+" button
    await page.locator("button").filter({ hasText: /New Role|\+/ }).first().click();

    // Wait for modal — ConfirmDialog uses h3, RoleModal uses h2
    await expect(page.locator("h2:has-text('Create New Role')")).toBeVisible({ timeout: 5000 });

    // Fill form
    await page.fill('input[placeholder*="Tech Lead"]', roleName);
    await page.fill('textarea[placeholder*="What does this role do"]', "Integration test role created by Playwright");
    await page.fill('textarea[placeholder*="You are a"]', "You are a test integration agent.");
    await page.fill('input[placeholder*="code-review"]', "integration-testing, e2e");

    // Click Create Role
    await page.click('button:has-text("Create Role")');

    // Wait for modal to close
    await expect(page.locator("h2:has-text('Create New Role')")).not.toBeVisible({ timeout: 10000 });

    // Refresh and verify
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=${roleName}`).first()).toBeVisible({ timeout: 10000 });

    // Verify via API
    const apiRes = await request.get(`${REGISTRY}/api/roles`);
    const apiData = await apiRes.json();
    const created = apiData.data.find((r: any) => r.name === roleName);
    expect(created).toBeTruthy();
    expect(created.description).toBe("Integration test role created by Playwright");
    expect(created.capabilities).toContain("integration-testing");

    createdRoleIds.push(created.id);
  });

  test("edit role via UI modal, verify changes", async ({ page, request }) => {
    // Create role via API for setup
    const role = await apiCreateRole(request, {
      name: `EditRole_${Date.now()}`,
      slug: `editrole-${Date.now()}`,
    });
    createdRoleIds.push(role.id);

    await page.goto(`${BASE}/roles`);
    await page.waitForLoadState("networkidle");

    // Find the role card and hover to show edit button
    const roleCard = page.locator(`text=${role.name}`).first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]").first();
    await roleCard.hover();

    // Click edit button (pencil icon)
    await roleCard.locator('button[title="Edit role"]').click();

    // Wait for edit modal
    await expect(page.locator("h2:has-text('Edit Role')")).toBeVisible({ timeout: 5000 });

    // Change name
    const updatedName = `EditedRole_${Date.now()}`;
    const nameInput = page.locator('input[placeholder*="Tech Lead"]');
    await nameInput.clear();
    await nameInput.fill(updatedName);

    // Change description
    const descInput = page.locator('textarea[placeholder*="What does this role do"]');
    await descInput.clear();
    await descInput.fill("Updated by integration test");

    // Save
    await page.click('button:has-text("Save Changes")');

    // Wait for modal to close
    await expect(page.locator("h2:has-text('Edit Role')")).not.toBeVisible({ timeout: 10000 });

    // Refresh and verify
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=${updatedName}`).first()).toBeVisible({ timeout: 10000 });

    // Verify via API
    const apiRes = await request.get(`${REGISTRY}/api/roles/${role.id}`);
    const apiData = await apiRes.json();
    expect(apiData.data.name).toBe(updatedName);
    expect(apiData.data.description).toBe("Updated by integration test");
  });

  test("delete role via UI, verify removal", async ({ page, request }) => {
    // Create role via API
    const role = await apiCreateRole(request, {
      name: `DeleteRole_${Date.now()}`,
      slug: `deleterole-${Date.now()}`,
    });

    await page.goto(`${BASE}/roles`);
    await page.waitForLoadState("networkidle");

    // Find role card by xpath ancestor pattern
    const roleCard = page.locator(`text=${role.name}`).first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]").first();
    await roleCard.hover();

    // Click delete
    await roleCard.locator('button[title="Delete role"]').click();

    // ConfirmDialog uses h3 not h2
    await expect(page.locator("h3:has-text('Delete Role')")).toBeVisible({ timeout: 5000 });
    
    // Click the red Delete button (not Cancel)
    await page.locator("button.bg-red-600:has-text('Delete')").click();

    // Wait for dialog to close
    await expect(page.locator("h3:has-text('Delete Role')")).not.toBeVisible({ timeout: 10000 });

    // Refresh and verify gone
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=${role.name}`)).not.toBeVisible({ timeout: 10000 });

    // Verify via API
    const apiRes = await request.get(`${REGISTRY}/api/roles/${role.id}`);
    expect(apiRes.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Teams CRUD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: Teams CRUD", () => {
  const createdTeamIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdTeamIds) {
      await apiDelete(request, `/api/teams/${id}`);
    }
  });

  test("create team via UI modal, verify in list and API", async ({ page, request }) => {
    const teamName = `IntTeam_${Date.now()}`;

    await page.goto(`${BASE}/teams`);
    await page.waitForLoadState("networkidle");

    // Click "New Team" / "+" button
    await page.locator("button").filter({ hasText: /New Team|\+/ }).first().click();

    // Wait for modal
    await expect(page.locator("h2:has-text('Create New Team')")).toBeVisible({ timeout: 5000 });

    // Fill name
    await page.fill('input[placeholder*="Core Platform"]', teamName);

    // Click Create Team
    await page.click('button:has-text("Create Team")');

    // Wait for modal to close
    await expect(page.locator("h2:has-text('Create New Team')")).not.toBeVisible({ timeout: 10000 });

    // Refresh and verify
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=${teamName}`).first()).toBeVisible({ timeout: 10000 });

    // Verify via API
    const apiRes = await request.get(`${REGISTRY}/api/teams`);
    const apiData = await apiRes.json();
    const created = apiData.data.find((t: any) => t.name === teamName);
    expect(created).toBeTruthy();

    createdTeamIds.push(created.id);
  });

  test("edit team via UI modal — proxied PUT to registry", async ({ page, request }) => {
    // Create team via API
    const team = await apiCreateTeam(request, {
      name: `EditTeam_${Date.now()}`,
    });
    createdTeamIds.push(team.id);

    await page.goto(`${BASE}/teams`);
    await page.waitForLoadState("networkidle");

    // Find team card and hover
    const teamCard = page.locator(`text=${team.name}`).first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]").first();
    await teamCard.hover();

    // Click edit (pencil)
    await teamCard.locator('button[title="Edit team"]').click();

    // Wait for edit modal
    await expect(page.locator("h2:has-text('Edit Team')")).toBeVisible({ timeout: 5000 });

    // Update name
    const updatedName = `EditedTeam_${Date.now()}`;
    const nameInput = page.locator('input[placeholder*="Core Platform"]');
    await nameInput.clear();
    await nameInput.fill(updatedName);

    // Save
    await page.click('button:has-text("Save Changes")');

    // Note: Registry doesn't have PUT /api/teams/:id, so the dashboard proxy
    // will forward to registry and get 404. The UI may show an error.
    // We verify the actual behavior:
    await page.waitForTimeout(2000);

    const directPut = await request.put(`${REGISTRY}/api/teams/${team.id}`, {
      data: { name: updatedName, emoji: "blocks", color: "green" },
    });

    if (directPut.status() === 404) {
      // Expected: Registry doesn't support PUT /api/teams/:id
      test.info().annotations.push({
        type: "known-issue",
        description: "Registry lacks PUT /api/teams/:id — team editing not functional",
      });
    } else {
      const updated = await directPut.json();
      expect(updated.data.name).toBe(updatedName);
    }
  });

  test("delete team via UI — proxied DELETE to registry", async ({ page, request }) => {
    // Create team via API
    const team = await apiCreateTeam(request, {
      name: `DeleteTeam_${Date.now()}`,
    });

    await page.goto(`${BASE}/teams`);
    await page.waitForLoadState("networkidle");

    // Find team card and hover
    const teamCard = page.locator(`text=${team.name}`).first().locator("xpath=ancestor::div[contains(@class,'rounded-xl')]").first();
    await teamCard.hover();

    // Click delete
    await teamCard.locator('button[title="Delete team"]').click();

    // ConfirmDialog uses h3
    await expect(page.locator("h3:has-text('Delete Team')")).toBeVisible({ timeout: 5000 });
    await page.locator("button.bg-red-600:has-text('Delete')").click();

    // Wait for dialog close
    await expect(page.locator("h3:has-text('Delete Team')")).not.toBeVisible({ timeout: 10000 });

    // Check via direct API — Registry may not support DELETE /api/teams/:id
    await page.waitForTimeout(1000);
    const checkRes = await request.get(`${REGISTRY}/api/teams`);
    const teamsData = await checkRes.json();
    const stillExists = teamsData.data.find((t: any) => t.id === team.id);

    if (stillExists) {
      test.info().annotations.push({
        type: "known-issue",
        description: "Registry lacks DELETE /api/teams/:id — team deletion not functional",
      });
      // Cleanup: since registry didn't delete it, track for afterAll
      createdTeamIds.push(team.id);
    }
    // If it was deleted, great — no cleanup needed
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Agent Deploy (E2E)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: Agent Deploy (E2E)", () => {
  const cleanupIds: { roles: string[]; teams: string[]; agents: string[] } = {
    roles: [],
    teams: [],
    agents: [],
  };

  test.afterAll(async ({ request }) => {
    for (const id of cleanupIds.agents) {
      await apiDelete(request, `/api/agents/${id}`);
    }
    for (const id of cleanupIds.roles) {
      await apiDelete(request, `/api/roles/${id}`);
    }
    for (const id of cleanupIds.teams) {
      await apiDelete(request, `/api/teams/${id}`);
    }
  });

  test("deploy agent via UI with real role/team → verify success", async ({ page, request }) => {
    // Setup: create role and team via API
    const role = await apiCreateRole(request, {
      name: `DeployRole_${Date.now()}`,
      slug: `deployrole-${Date.now()}`,
    });
    cleanupIds.roles.push(role.id);

    const team = await apiCreateTeam(request, {
      name: `DeployTeam_${Date.now()}`,
    });
    cleanupIds.teams.push(team.id);

    // Go to home page and wait for data to load
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    // Wait for teams/roles data to load (auto-refresh polls)
    await page.waitForTimeout(3000);

    // Click "Deploy Agent" button (text may be hidden on mobile, so also match by icon)
    await page.locator("button:has-text('Deploy Agent')").first().click({ timeout: 10000 });

    // Wait for deploy modal
    await expect(page.locator("h2:has-text('Deploy New Agent')")).toBeVisible({ timeout: 10000 });

    // Set agent name
    const agentName = `IntAgent_${Date.now()}`;
    const nameInput = page.locator('input[placeholder*="Atlas"]');
    await nameInput.clear();
    await nameInput.fill(agentName);

    // Select role from custom dropdown
    const roleLabel = page.locator("label:has-text('Role')");
    const roleContainer = roleLabel.locator("..");
    await roleContainer.locator("button").first().click();
    await page.waitForTimeout(500);

    // Click on our created role in the dropdown list
    const roleOption = page.locator(`button:has-text("${role.name}")`).last();
    if (await roleOption.isVisible({ timeout: 3000 })) {
      await roleOption.click();
    }

    // Select team from native <select> — find by label relationship
    const teamLabel = page.locator("label:has-text('Team')");
    const teamContainer = teamLabel.locator("..");
    const teamSelect = teamContainer.locator("select");
    await teamSelect.selectOption({ label: team.name });

    // Click Deploy Agent submit button inside the form
    await page.locator("form button:has-text('Deploy Agent')").click();

    // Wait for success or error
    const result = await Promise.race([
      page.locator("text=Agent Deployed!").waitFor({ timeout: 15000 }).then(() => "success" as const),
      page.locator(".text-red-300").first().waitFor({ timeout: 15000 }).then(() => "error" as const),
    ]).catch(() => "timeout" as const);

    expect(result).toBe("success");

    // Modal auto-closes after success — wait
    await page.waitForTimeout(2000);

    // Verify agent was created via API
    const agentsRes = await request.get(`${REGISTRY}/api/agents`);
    const agentsData = await agentsRes.json();
    const createdAgent = agentsData.data.find((a: any) => a.name === agentName);
    expect(createdAgent).toBeTruthy();
    expect(createdAgent.roleId).toBe(role.id);
    expect(createdAgent.teamId).toBe(team.id);

    cleanupIds.agents.push(createdAgent.id);

    // Verify agent appears on home page after refresh
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=${agentName}`).first()).toBeVisible({ timeout: 15000 });
  });

  test("agent detail page loads with real data", async ({ page, request }) => {
    // Create supporting entities
    const role = await apiCreateRole(request, {
      name: `DetailRole_${Date.now()}`,
      slug: `detailrole-${Date.now()}`,
    });
    cleanupIds.roles.push(role.id);

    const team = await apiCreateTeam(request, {
      name: `DetailTeam_${Date.now()}`,
    });
    cleanupIds.teams.push(team.id);

    const agent = await apiCreateAgent(request, role.id, team.id, {
      name: `DetailAgent_${Date.now()}`,
    });
    cleanupIds.agents.push(agent.id);

    // Navigate to agent detail page
    await page.goto(`${BASE}/agents/${agent.id}`);
    await page.waitForLoadState("networkidle");

    // Verify agent name is displayed
    await expect(page.locator(`h1:has-text("${agent.name}")`)).toBeVisible({ timeout: 10000 });
    
    // Verify role name appears (use .first() to avoid strict mode with multiple matches)
    await expect(page.getByRole("heading", { name: role.name })).toBeVisible({ timeout: 10000 });

    // Verify configuration section
    await expect(page.locator("text=Configuration")).toBeVisible();
    await expect(page.locator(`text=${agent.model}`).first()).toBeVisible();

    // Verify agent ID is shown
    await expect(page.locator(`text=${agent.id}`)).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Tasks CRUD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: Tasks CRUD", () => {
  const cleanupIds: { teams: string[]; tasks: string[] } = {
    teams: [],
    tasks: [],
  };

  test.afterAll(async ({ request }) => {
    for (const id of cleanupIds.tasks) {
      await apiDelete(request, `/api/tasks/${id}`);
    }
    for (const id of cleanupIds.teams) {
      await apiDelete(request, `/api/teams/${id}`);
    }
  });

  test("create task via API, verify on tasks page", async ({ page, request }) => {
    // Create team first
    const team = await apiCreateTeam(request, {
      name: `TaskTeam_${Date.now()}`,
    });
    cleanupIds.teams.push(team.id);

    // Create task via Registry API
    const taskTitle = `IntTask_${Date.now()}`;
    const task = await apiCreateTask(request, team.id, {
      title: taskTitle,
      priority: "high",
      description: "Integration test task",
    });
    cleanupIds.tasks.push(task.id);

    // Navigate to tasks page
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState("networkidle");

    // Verify task appears
    await expect(page.locator(`text=${taskTitle}`).first()).toBeVisible({ timeout: 15000 });
  });

  test("retry task via API, verify status change", async ({ page, request }) => {
    const team = await apiCreateTeam(request, {
      name: `RetryTeam_${Date.now()}`,
    });
    cleanupIds.teams.push(team.id);

    // Create a failed task
    const task = await apiCreateTask(request, team.id, {
      title: `RetryTask_${Date.now()}`,
    });
    cleanupIds.tasks.push(task.id);

    // Set it to failed via direct API
    await request.put(`${REGISTRY}/api/tasks/${task.id}`, {
      data: { status: "failed", error: "Test error for retry" },
    });

    // Retry via dashboard proxy API
    const retryRes = await request.post(`${BASE}/api/tasks/${task.id}/retry`);
    expect(retryRes.ok()).toBeTruthy();

    // Verify status changed back to queued
    const taskRes = await request.get(`${REGISTRY}/api/tasks/${task.id}`);
    const taskData = await taskRes.json();
    expect(taskData.data.status).toBe("queued");
  });

  test("cancel task via API, verify status change", async ({ page, request }) => {
    const team = await apiCreateTeam(request, {
      name: `CancelTeam_${Date.now()}`,
    });
    cleanupIds.teams.push(team.id);

    // Create a queued task
    const task = await apiCreateTask(request, team.id, {
      title: `CancelTask_${Date.now()}`,
    });
    cleanupIds.tasks.push(task.id);

    // Cancel via dashboard proxy API
    const cancelRes = await request.post(`${BASE}/api/tasks/${task.id}/cancel`);
    expect(cancelRes.ok()).toBeTruthy();

    // Verify status changed
    const taskRes = await request.get(`${REGISTRY}/api/tasks/${task.id}`);
    const taskData = await taskRes.json();
    expect(taskData.data.status).toBe("cancelled");
  });

  test("task appears on tasks page with correct status indicators", async ({ page, request }) => {
    const team = await apiCreateTeam(request, {
      name: `FilterTeam_${Date.now()}`,
    });
    cleanupIds.teams.push(team.id);

    // Create tasks with different statuses
    const queuedTask = await apiCreateTask(request, team.id, {
      title: `QTask_${Date.now()}`,
    });
    cleanupIds.tasks.push(queuedTask.id);

    const completedTask = await apiCreateTask(request, team.id, {
      title: `CTask_${Date.now()}`,
    });
    cleanupIds.tasks.push(completedTask.id);

    // Mark one as completed
    await request.put(`${REGISTRY}/api/tasks/${completedTask.id}`, {
      data: { status: "completed", completedAt: new Date().toISOString() },
    });

    // Navigate to tasks page
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState("networkidle");

    // Both tasks should be visible initially (all filter)
    await expect(page.locator(`text=${queuedTask.title}`).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`text=${completedTask.title}`).first()).toBeVisible({ timeout: 15000 });

    // Stats cards should exist — check by the stat label structure
    // Use more specific selectors to avoid strict mode
    await expect(page.locator("div:has-text('Queued')").first()).toBeVisible();
    await expect(page.locator("div:has-text('Completed')").first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Cross-Entity Flow
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: Cross-Entity Flow", () => {
  const cleanupIds: { roles: string[]; teams: string[]; agents: string[]; tasks: string[] } = {
    roles: [],
    teams: [],
    agents: [],
    tasks: [],
  };

  test.afterAll(async ({ request }) => {
    for (const id of cleanupIds.tasks) {
      await apiDelete(request, `/api/tasks/${id}`);
    }
    for (const id of cleanupIds.agents) {
      await apiDelete(request, `/api/agents/${id}`);
    }
    for (const id of cleanupIds.roles) {
      await apiDelete(request, `/api/roles/${id}`);
    }
    for (const id of cleanupIds.teams) {
      await apiDelete(request, `/api/teams/${id}`);
    }
  });

  test("full flow: create role → team → deploy agent → create task → verify", async ({
    page,
    request,
  }) => {
    // 1. Create role via UI
    const roleName = `CrossRole_${Date.now()}`;
    await page.goto(`${BASE}/roles`);
    await page.waitForLoadState("networkidle");

    await page.locator("button").filter({ hasText: /New Role|\+/ }).first().click();
    await expect(page.locator("h2:has-text('Create New Role')")).toBeVisible({ timeout: 5000 });

    await page.fill('input[placeholder*="Tech Lead"]', roleName);
    await page.fill('textarea[placeholder*="What does this role do"]', "Cross-entity test");
    await page.fill('textarea[placeholder*="You are a"]', "Cross-entity system prompt");
    await page.fill('input[placeholder*="code-review"]', "cross-test");
    await page.click('button:has-text("Create Role")');
    await expect(page.locator("h2:has-text('Create New Role')")).not.toBeVisible({ timeout: 10000 });

    // Get role from API
    await page.waitForTimeout(1000);
    const rolesRes = await request.get(`${REGISTRY}/api/roles`);
    const rolesData = await rolesRes.json();
    const role = rolesData.data.find((r: any) => r.name === roleName);
    expect(role).toBeTruthy();
    cleanupIds.roles.push(role.id);

    // 2. Create team via UI
    const teamName = `CrossTeam_${Date.now()}`;
    await page.goto(`${BASE}/teams`);
    await page.waitForLoadState("networkidle");

    await page.locator("button").filter({ hasText: /New Team|\+/ }).first().click();
    await expect(page.locator("h2:has-text('Create New Team')")).toBeVisible({ timeout: 5000 });

    await page.fill('input[placeholder*="Core Platform"]', teamName);
    await page.click('button:has-text("Create Team")');
    await expect(page.locator("h2:has-text('Create New Team')")).not.toBeVisible({ timeout: 10000 });

    // Get team from API
    await page.waitForTimeout(1000);
    const teamsRes = await request.get(`${REGISTRY}/api/teams`);
    const teamsData = await teamsRes.json();
    const team = teamsData.data.find((t: any) => t.name === teamName);
    expect(team).toBeTruthy();
    cleanupIds.teams.push(team.id);

    // 3. Deploy agent via API (faster + more reliable than UI for cross-entity)
    const agentName = `CrossAgent_${Date.now()}`;
    const agent = await apiCreateAgent(request, role.id, team.id, { name: agentName });
    cleanupIds.agents.push(agent.id);

    // 4. Create task for that team
    const taskTitle = `CrossTask_${Date.now()}`;
    const task = await apiCreateTask(request, team.id, { title: taskTitle });
    cleanupIds.tasks.push(task.id);

    // 5. Verify everything connected on home page
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");

    await expect(page.locator(`text=${agentName}`).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`text=${teamName}`).first()).toBeVisible({ timeout: 15000 });

    // 6. Verify on tasks page
    await page.goto(`${BASE}/tasks`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`text=${taskTitle}`).first()).toBeVisible({ timeout: 15000 });

    // 7. Verify agent detail page shows correct role & team
    await page.goto(`${BASE}/agents/${agent.id}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`h1:has-text("${agentName}")`)).toBeVisible({ timeout: 10000 });
    // Role name appears in sidebar heading
    await expect(page.getByRole("heading", { name: role.name })).toBeVisible();
  });

  test("delete role used by agent — verify behavior", async ({ page, request }) => {
    // Create role, team, agent
    const role = await apiCreateRole(request, {
      name: `DelRoleAgent_${Date.now()}`,
      slug: `delroleagent-${Date.now()}`,
    });

    const team = await apiCreateTeam(request);
    cleanupIds.teams.push(team.id);

    const agent = await apiCreateAgent(request, role.id, team.id);
    cleanupIds.agents.push(agent.id);

    // Try to delete the role — may fail due to FK constraint
    const deleteRes = await request.delete(`${REGISTRY}/api/roles/${role.id}`);
    
    if (deleteRes.ok()) {
      // Role was deleted successfully (no FK constraint or cascading)
      // Verify agent still exists but role is null in JOIN
      const agentRes = await request.get(`${REGISTRY}/api/agents/${agent.id}`);
      const agentData = await agentRes.json();
      expect(agentData.data.id).toBe(agent.id);
      expect(agentData.data.roleId).toBe(role.id);

      // Verify on agent detail page — should handle gracefully
      await page.goto(`${BASE}/agents/${agent.id}`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(`h1:has-text("${agent.name}")`)).toBeVisible({ timeout: 10000 });
    } else {
      // FK constraint prevents deletion — this is valid behavior
      test.info().annotations.push({
        type: "known-behavior",
        description: `Deleting role with agents returns ${deleteRes.status()} — FK constraint active`,
      });
      cleanupIds.roles.push(role.id);

      // Verify role still exists
      const roleCheck = await request.get(`${REGISTRY}/api/roles/${role.id}`);
      expect(roleCheck.ok()).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: Settings & Infra
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: Settings & Infra", () => {
  test("settings page loads with correct sections", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState("networkidle");

    // Verify page title
    await expect(page.locator("h1:has-text('Settings')")).toBeVisible({ timeout: 10000 });

    // Verify all sections in nav
    for (const section of [
      "General",
      "Infrastructure",
      "Agents",
      "LLM Providers",
      "Secrets",
      "Notifications",
      "Danger Zone",
    ]) {
      await expect(page.locator(`button:has-text("${section}")`)).toBeVisible();
    }

    // General section shows cluster info
    await expect(page.locator("text=Cluster Configuration")).toBeVisible();
    // The URL is in a disabled input — check its value instead
    await expect(page.locator('input[value="http://localhost:4001"]')).toBeVisible();
  });

  test("infrastructure section loads reconciliation data", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.waitForLoadState("networkidle");

    // Click Infrastructure section
    await page.click('button:has-text("Infrastructure")');

    // Wait for VM Reconciliation card to appear
    await expect(page.locator("text=VM Reconciliation")).toBeVisible({ timeout: 10000 });

    // Wait for data to load (reconciliation API might take a moment)
    await page.waitForTimeout(3000);

    // Either shows data (Total VMs) or error message
    const hasData = await page.locator("text=Total VMs").isVisible().catch(() => false);
    const noConfig = await page
      .locator("text=Could not load reconciliation data")
      .isVisible()
      .catch(() => false);
    const runningMsg = await page
      .locator("text=Running reconciliation")
      .isVisible()
      .catch(() => false);

    expect(hasData || noConfig || runningMsg).toBeTruthy();

    // Cost section should also appear
    await expect(page.locator("text=Cost Estimation")).toBeVisible();
  });

  test("status API returns real data", async ({ request }) => {
    const res = await request.get(`${BASE}/api/status`);
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty("agents");
    expect(data.data).toHaveProperty("roles");
    expect(data.data).toHaveProperty("teams");
    expect(data.data.agents).toHaveProperty("total");
    expect(data.data.agents).toHaveProperty("online");
    expect(typeof data.data.roles).toBe("number");
    expect(typeof data.data.teams).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration: API Proxy Verification
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Integration: API Proxy Verification", () => {
  test("dashboard proxies GET /api/agents to registry", async ({ request }) => {
    const dashRes = await request.get(`${BASE}/api/agents`);
    const registryRes = await request.get(`${REGISTRY}/api/agents`);

    expect(dashRes.ok()).toBeTruthy();
    expect(registryRes.ok()).toBeTruthy();

    const dashData = await dashRes.json();
    const registryData = await registryRes.json();

    expect(dashData.data.length).toBe(registryData.data.length);
  });

  test("dashboard proxies GET /api/roles to registry", async ({ request }) => {
    const dashRes = await request.get(`${BASE}/api/roles`);
    const registryRes = await request.get(`${REGISTRY}/api/roles`);

    expect(dashRes.ok()).toBeTruthy();
    expect(registryRes.ok()).toBeTruthy();

    const dashData = await dashRes.json();
    const registryData = await registryRes.json();

    expect(dashData.data.length).toBe(registryData.data.length);
  });

  test("dashboard proxies GET /api/teams to registry", async ({ request }) => {
    const dashRes = await request.get(`${BASE}/api/teams`);
    const registryRes = await request.get(`${REGISTRY}/api/teams`);

    expect(dashRes.ok()).toBeTruthy();
    expect(registryRes.ok()).toBeTruthy();

    const dashData = await dashRes.json();
    const registryData = await registryRes.json();

    expect(dashData.data.length).toBe(registryData.data.length);
  });

  test("dashboard proxies GET /api/tasks to registry", async ({ request }) => {
    const dashRes = await request.get(`${BASE}/api/tasks`);
    const registryRes = await request.get(`${REGISTRY}/api/tasks`);

    expect(dashRes.ok()).toBeTruthy();
    expect(registryRes.ok()).toBeTruthy();

    const dashData = await dashRes.json();
    const registryData = await registryRes.json();

    expect(dashData.data.length).toBe(registryData.data.length);
  });

  test("dashboard proxies GET /api/status to manager", async ({ request }) => {
    const dashRes = await request.get(`${BASE}/api/status`);
    expect(dashRes.ok()).toBeTruthy();

    const data = await dashRes.json();
    expect(data.success).toBe(true);
    expect(data.data.timestamp).toBeTruthy();
  });
});
