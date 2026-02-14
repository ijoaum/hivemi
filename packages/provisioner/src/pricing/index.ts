// =============================================================================
// Pricing Tables
// Static pricing data per cloud provider and instance size
// =============================================================================

import type { SizeMappings } from "../types.js";

/**
 * DigitalOcean pricing (as of 2026).
 */
export const DIGITALOCEAN_PRICING: SizeMappings = {
  small: { slug: "s-1vcpu-1gb", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 6 },
  medium: { slug: "s-2vcpu-2gb", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 12 },
  large: { slug: "s-2vcpu-4gb-amd", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 24 },
};

/**
 * GCP pricing (as of 2026, e2 series).
 */
export const GCP_PRICING: SizeMappings = {
  small: { slug: "e2-micro", vcpu: 1, memoryMb: 1024, monthlyCostUsd: 7 },
  medium: { slug: "e2-small", vcpu: 2, memoryMb: 2048, monthlyCostUsd: 13 },
  large: { slug: "e2-medium", vcpu: 2, memoryMb: 4096, monthlyCostUsd: 25 },
};

/**
 * All provider pricing tables indexed by provider name.
 */
export const PROVIDER_PRICING: Record<string, SizeMappings> = {
  digitalocean: DIGITALOCEAN_PRICING,
  gcp: GCP_PRICING,
};

/**
 * Get pricing for a provider by name. Throws if provider not found.
 */
export function getPricingForProvider(provider: string): SizeMappings {
  const pricing = PROVIDER_PRICING[provider.toLowerCase()];
  if (!pricing) {
    throw new Error(`Unknown provider: ${provider}. Available: ${Object.keys(PROVIDER_PRICING).join(", ")}`);
  }
  return pricing;
}

/**
 * Get monthly cost for a specific provider and instance size.
 */
export function getMonthlyCost(provider: string, size: keyof SizeMappings): number {
  const pricing = getPricingForProvider(provider);
  return pricing[size].monthlyCostUsd;
}

/**
 * List all supported providers.
 */
export function listProviders(): string[] {
  return Object.keys(PROVIDER_PRICING);
}
