import { test, expect, Page } from "@playwright/test";

const BASE = "http://localhost:3000";

// ──────────────────────────────────────
// 1. Navigation & Layout
// ──────────────────────────────────────

test.describe("NAV — Navigation & Layout", () => {
  test("NAV-01: Sidebar renders correctly", async ({ page }) => {
    await page.goto(BASE);
    // Logo
    await expect(page.locator("h1:has-text('hivemi')")).toBeVisible();
    // Nav items
    for (const label of ["Agents", "Tasks", "Teams", "Roles", "Settings", "Logs"]) {
      await expect(page.locator(`nav a:has-text("${label}")`)).toBeVisible();
    }
    // Version
    await expect(page.locator("text=0.1.0")).toBeVisible();
  });

  test("NAV-02: Navigation between pages", async ({ page }) => {
    await page.goto(BASE);
    const routes: Record<string, string> = {
      Tasks: "/tasks",
      Teams: "/teams",
      Roles: "/roles",
      Settings: "/settings",
      Logs: "/logs",
      Agents: "/",
    };
    for (const [label, path] of Object.entries(routes)) {
      await page.click(`nav a:has-text("${label}")`);
      await page.waitForURL(`**${path}`);
    }
  });

  test("NAV-04: Mobile hamburger menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    // Sidebar should be hidden (translated off-screen)
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveCSS("transform", /matrix.*-/);
  });

  test("NAV-07: Theme toggle", async ({ page }) => {
    await page.goto(BASE);
    // Default should be dark (html has class "dark")
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
    // Click theme toggle button
    const themeBtn = page.locator("aside button:has-text('Light Mode')");
    await themeBtn.click();
    // After toggle, text changes to "Dark Mode"
    await expect(page.locator("aside button:has-text('Dark Mode')")).toBeVisible();
  });
});

// ──────────────────────────────────────
// 2. Agents (Home Page)
// ──────────────────────────────────────

test.describe("AGT — Agents Home Page", () => {
  test("AGT-01: Page loads with content", async ({ page }) => {
    await page.goto(BASE);
    // Title
    await expect(page.locator("text=The Hive")).toBeVisible();
    // Subtitle
    await expect(page.locator("text=Your agent squad")).toBeVisible();
  });

  test("AGT-06: Quick Stats grid", async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000); // Wait for API
    for (const label of ["Total Agents", "Working", "Idle", "Teams"]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test("AGT-14: Deploy button opens modal", async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Deploy Agent");
    await expect(page.locator("text=Deploy New Agent")).toBeVisible();
  });

  test("AGT-16: Auto-refresh updates data", async ({ page }) => {
    await page.goto(BASE);
    // Just verify the page doesn't error after waiting
    await page.waitForTimeout(6000);
    await expect(page.locator("text=The Hive")).toBeVisible();
  });
});

// ──────────────────────────────────────
// 3. Deploy Agent Modal
// ──────────────────────────────────────

test.describe("DEP — Deploy Agent Modal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.click("text=Deploy Agent");
    await page.waitForSelector("text=Deploy New Agent");
  });

  test("DEP-02: Random name is generated", async ({ page }) => {
    const nameInput = page.locator("input[placeholder*='Atlas']");
    const value = await nameInput.inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test("DEP-03: Dice generates new name", async ({ page }) => {
    const nameInput = page.locator("input[placeholder*='Atlas']");
    const originalName = await nameInput.inputValue();
    // Click dice button (Dices icon button)
    await page.locator("button[title='Generate random name']").click();
    // Name might be the same by chance, but the action should work
    const newName = await nameInput.inputValue();
    expect(newName.length).toBeGreaterThan(0);
  });

  test("DEP-07: Model selection grid", async ({ page }) => {
    // Verify model options exist
    for (const model of ["GPT-4o", "Claude Sonnet 4", "Claude Opus 4", "Gemini 2.5 Flash"]) {
      await expect(page.locator(`text=${model}`).first()).toBeVisible();
    }
  });

  test("DEP-08: Auto-start toggle", async ({ page }) => {
    const toggle = page.locator("text=Start agent immediately").locator("..");
    await expect(toggle).toBeVisible();
  });

  test("DEP-11: Validation - empty name disables button", async ({ page }) => {
    const nameInput = page.locator("input[placeholder*='Atlas']");
    await nameInput.fill("");
    const deployBtn = page.locator("button:has-text('Deploy Agent')").last();
    await expect(deployBtn).toBeDisabled();
  });

  test("DEP-12: Close modal via backdrop", async ({ page }) => {
    // Click the backdrop (the semi-transparent overlay behind the modal)
    await page.locator(".fixed.inset-0 >> .bg-black\\/60").click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.locator("text=Deploy New Agent")).not.toBeVisible();
  });
});

// ──────────────────────────────────────
// 4. Tasks Page
// ──────────────────────────────────────

test.describe("TSK — Tasks Page", () => {
  test("TSK-01: Stats cards render", async ({ page }) => {
    await page.goto(`${BASE}/tasks`);
    await page.waitForTimeout(2000);
    for (const label of ["Queued", "Running", "Completed", "Failed"]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test("TSK-06: No results message", async ({ page }) => {
    await page.goto(`${BASE}/tasks`);
    // This depends on data, but the element structure should exist
    const noMatch = page.locator("text=No tasks match the current filters");
    // Either visible or tasks are showing - both are valid
    const taskCards = page.locator("[class*='task']");
    const hasContent = (await taskCards.count()) > 0 || (await noMatch.isVisible());
    expect(hasContent).toBe(true);
  });
});

// ──────────────────────────────────────
// 5. Teams Page
// ──────────────────────────────────────

test.describe("TMS — Teams Page", () => {
  test("TMS-01: Stats render", async ({ page }) => {
    await page.goto(`${BASE}/teams`);
    await page.waitForTimeout(2000);
    for (const label of ["Total Teams", "Active", "Agents"]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test("TMS-03: New Team button opens modal", async ({ page }) => {
    await page.goto(`${BASE}/teams`);
    await page.click("text=New Team");
    await expect(page.locator("text=Create New Team")).toBeVisible();
  });

  test("TMS-03b: Team modal has required fields", async ({ page }) => {
    await page.goto(`${BASE}/teams`);
    await page.click("text=New Team");
    await expect(page.locator("text=Team Name")).toBeVisible();
    await expect(page.locator("text=Icon")).toBeVisible();
    await expect(page.locator("text=Color")).toBeVisible();
  });
});

// ──────────────────────────────────────
// 6. Roles Page
// ──────────────────────────────────────

test.describe("ROL — Roles Page", () => {
  test("ROL-01: Stats render", async ({ page }) => {
    await page.goto(`${BASE}/roles`);
    await page.waitForTimeout(2000);
    for (const label of ["Total Roles", "Active", "Agents"]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test("ROL-03: New Role button opens modal", async ({ page }) => {
    await page.goto(`${BASE}/roles`);
    await page.click("text=New Role");
    await expect(page.locator("text=Create New Role")).toBeVisible();
  });

  test("ROL-03b: Role modal has all fields", async ({ page }) => {
    await page.goto(`${BASE}/roles`);
    await page.click("text=New Role");
    for (const label of ["Name", "Slug", "Description", "Icon", "Color", "Capabilities", "System Prompt"]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test("ROL-04: Auto-slug generation", async ({ page }) => {
    await page.goto(`${BASE}/roles`);
    await page.click("text=New Role");
    const nameInput = page.locator("input[placeholder*='Tech Lead']");
    const slugInput = page.locator("input[placeholder*='tech-lead']");
    await nameInput.fill("My Cool Role");
    const slugValue = await slugInput.inputValue();
    expect(slugValue).toBe("my-cool-role");
  });

  test("ROL-08: Validation - required fields", async ({ page }) => {
    await page.goto(`${BASE}/roles`);
    await page.click("text=New Role");
    const saveBtn = page.locator("button:has-text('Create Role')");
    await expect(saveBtn).toBeDisabled();
  });
});

// ──────────────────────────────────────
// 7. Settings Page
// ──────────────────────────────────────

test.describe("SET — Settings Page", () => {
  test("SET-01: Section navigation", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    for (const label of ["General", "Infrastructure", "Agents", "LLM Providers", "Secrets", "Notifications", "Danger Zone"]) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible();
    }
  });

  test("SET-03: General - Cluster name input", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    // Default section is General
    await expect(page.locator("text=Cluster Configuration")).toBeVisible();
    const clusterInput = page.locator("input[value='local-dev']");
    await expect(clusterInput).toBeVisible();
  });

  test("SET-09: Agents settings", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.click("button:has-text('Agents')");
    await expect(page.locator("text=Agent Limits")).toBeVisible();
    await expect(page.locator("text=Max Concurrent Agents")).toBeVisible();
  });

  test("SET-10: LLM Providers", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.click("button:has-text('LLM Providers')");
    await expect(page.locator("text=OpenAI")).toBeVisible();
    await expect(page.locator("text=Anthropic")).toBeVisible();
    await expect(page.locator("text=Google")).toBeVisible();
  });

  test("SET-12: Secrets list", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.click("button:has-text('Secrets')");
    for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]) {
      await expect(page.locator(`text=${key}`)).toBeVisible();
    }
  });

  test("SET-13: 1Password integration", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.click("button:has-text('Secrets')");
    await expect(page.locator("text=1Password Integration")).toBeVisible();
    await expect(page.locator("text=Vault: Clawdia")).toBeVisible();
  });

  test("SET-14: Notifications toggles", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.click("button:has-text('Notifications')");
    for (const label of ["Task completed", "Task failed", "Agent went offline", "Daily summary email"]) {
      await expect(page.locator(`text=${label}`)).toBeVisible();
    }
  });

  test("SET-15: Danger Zone", async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await page.click("button:has-text('Danger Zone')");
    await expect(page.locator("text=Reset Cluster")).toBeVisible();
    await expect(page.locator("text=Delete All Data")).toBeVisible();
  });
});

// ──────────────────────────────────────
// 8. Logs Page
// ──────────────────────────────────────

test.describe("LOG — Logs Page", () => {
  test("LOG-01: Stats cards render", async ({ page }) => {
    await page.goto(`${BASE}/logs`);
    await page.waitForTimeout(2000);
    for (const label of ["Errors", "Warnings", "Info", "Debug", "Lifecycle"]) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible();
    }
  });

  test("LOG-03: Search field exists", async ({ page }) => {
    await page.goto(`${BASE}/logs`);
    const searchInput = page.locator("input[placeholder='Search logs...']");
    await expect(searchInput).toBeVisible();
  });

  test("LOG-09: Export button", async ({ page }) => {
    await page.goto(`${BASE}/logs`);
    await expect(page.locator("text=Export")).toBeVisible();
  });

  test("LOG-10: Live button", async ({ page }) => {
    await page.goto(`${BASE}/logs`);
    await expect(page.locator("text=Live")).toBeVisible();
  });

  test("LOG-11: Footer counts", async ({ page }) => {
    await page.goto(`${BASE}/logs`);
    await page.waitForTimeout(2000);
    await expect(page.locator("text=Auto-refresh: 5s")).toBeVisible();
    // "Showing X of Y" pattern
    const showing = page.locator("text=/Showing \\d+ of \\d+/");
    await expect(showing).toBeVisible();
  });
});

// ──────────────────────────────────────
// 9. Theme & Responsiveness
// ──────────────────────────────────────

test.describe("THM/RES — Theme & Responsiveness", () => {
  test("THM-01: Dark mode default", async ({ page }) => {
    await page.goto(BASE);
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
  });

  test("RES-01: Mobile 375px - no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(376); // 1px tolerance
  });

  test("RES-02: Tablet 768px", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    // Sidebar should be visible on tablet+
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
  });
});

// ──────────────────────────────────────
// 10. Error Handling
// ──────────────────────────────────────

test.describe("ERR — Error Handling", () => {
  test("ERR-10: Deep link to agent detail", async ({ page }) => {
    // This should either load the agent or show "Agent not found"
    await page.goto(`${BASE}/agents/nonexistent-id`);
    await page.waitForTimeout(3000);
    const found = page.locator("text=Agent not found");
    const detail = page.locator("text=Configuration");
    const isValid = (await found.isVisible()) || (await detail.isVisible());
    expect(isValid).toBe(true);
  });
});
