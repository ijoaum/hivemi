// =============================================================================
// Cost Estimation
// Estimate monthly costs based on instance sizes and provider pricing
// =============================================================================

import type {
  ICloudProvider,
  Instance,
  InstanceSize,
  CostEstimate,
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
