// =============================================================================
// Cost Estimation
// Estimate monthly costs based on instance sizes and provider pricing
// =============================================================================

import type {
  ICloudProvider,
  Instance,
  InstanceSize,
  CostEstimate,
  CostReport,
  InstanceCostBreakdown,
} from "./types.js";

/**
 * Estimate the monthly cost for a single instance size.
 */
export function estimateInstanceCost(
  provider: ICloudProvider,
  size: InstanceSize,
): number {
  return provider.sizeMappings[size].monthlyCostUsd;
}

/**
 * Estimate total monthly cost for a list of instances.
 * Returns a CostEstimate with per-instance breakdown and summary.
 */
export function estimateCost(
  provider: ICloudProvider,
  instances: Array<{ name: string; size: InstanceSize }>,
): CostEstimate {
  const items = instances.map((inst) => ({
    name: inst.name,
    size: inst.size,
    monthlyCostUsd: estimateInstanceCost(provider, inst.size),
  }));

  const totalMonthlyCostUsd = items.reduce(
    (sum, item) => sum + item.monthlyCostUsd,
    0,
  );

  // Group by size for summary
  const sizeCounts = new Map<InstanceSize, number>();
  for (const item of items) {
    sizeCounts.set(item.size, (sizeCounts.get(item.size) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const [size, count] of sizeCounts) {
    parts.push(`${count} ${size}`);
  }

  const summary = `${instances.length} agentes (${parts.join(", ")}) na ${provider.name} ≈ $${totalMonthlyCostUsd}/mês`;

  return {
    provider: provider.name,
    instances: items,
    totalMonthlyCostUsd,
    summary,
  };
}

/**
 * Estimate cost from live instances (already provisioned).
 */
export function estimateCostFromInstances(
  provider: ICloudProvider,
  instances: Instance[],
): CostEstimate {
  return estimateCost(
    provider,
    instances.map((inst) => ({ name: inst.name, size: inst.size })),
  );
}

/**
 * Calculate the number of days between two dates (fractional).
 */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, (end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Get number of days in the month of the given date.
 */
function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Get the day of the month (1-based) for the given date.
 */
function dayOfMonth(date: Date): number {
  return date.getDate();
}

/**
 * Generate a full cost report with projected and accumulated costs.
 *
 * - `monthly`: cost if all current VMs run for a full month
 * - `accumulated`: prorated cost each VM has incurred this month based on `createdAt`
 * - `projected`: estimated total cost for the full month based on current trajectory
 *
 * @param provider - Cloud provider with size/pricing mappings
 * @param instances - Active instances with createdAt dates
 * @param now - Current date (defaults to Date.now(), injectable for testing)
 */
export function generateCostReport(
  provider: ICloudProvider,
  instances: Instance[],
  now: Date = new Date(),
): CostReport {
  const totalDays = daysInMonth(now);
  const currentDay = dayOfMonth(now);
  const dailyFraction = currentDay / totalDays;

  const breakdown: InstanceCostBreakdown[] = instances.map((inst) => {
    const monthlyCost = estimateInstanceCost(provider, inst.size);

    // How many days has this VM been running (capped at days elapsed in month)
    const createdAt = inst.createdAt instanceof Date ? inst.createdAt : new Date(inst.createdAt);

    // If created before this month, it's been running the full elapsed period
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const effectiveStart = createdAt > monthStart ? createdAt : monthStart;
    const daysRunning = Math.min(daysBetween(effectiveStart, now), currentDay);

    // Accumulated = (monthlyCost / daysInMonth) * daysRunning
    const dailyCost = monthlyCost / totalDays;
    const accumulatedCostUsd = Math.round(dailyCost * daysRunning * 100) / 100;

    return {
      name: inst.name,
      size: inst.size,
      monthlyCostUsd: monthlyCost,
      daysRunning: Math.round(daysRunning * 10) / 10,
      accumulatedCostUsd,
    };
  });

  const monthly = breakdown.reduce((sum, b) => sum + b.monthlyCostUsd, 0);
  const accumulated = Math.round(breakdown.reduce((sum, b) => sum + b.accumulatedCostUsd, 0) * 100) / 100;

  // Projected: if we're 15 days into a 30-day month and have spent $20,
  // projected = $20 / (15/30) = $40. Guard against division by zero.
  const projected = dailyFraction > 0
    ? Math.round((accumulated / dailyFraction) * 100) / 100
    : monthly;

  return {
    monthly,
    projected,
    accumulated,
    breakdown,
    provider: provider.name,
    generatedAt: now.toISOString(),
  };
}
