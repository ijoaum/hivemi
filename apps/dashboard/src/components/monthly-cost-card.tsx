"use client";

import { useState, useCallback } from "react";
import { useApi } from "@/hooks/use-api";
import { infraApi, type CostReport } from "@/lib/api";
import { DollarSign, TrendingUp, AlertCircle, Loader2 } from "lucide-react";

function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}

function formatCurrencyFull(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function MonthlyCostCard() {
  const [showBreakdown, setShowBreakdown] = useState(false);

  const costsFetcher = useCallback(() => infraApi.costs(), []);
  const { data: costReport, loading, error } = useApi<CostReport>(costsFetcher, {
    refetchInterval: 60000, // refresh every 60s (costs don't change often)
    cacheKey: "infra-costs",
  });

  // Loading state
  if (loading && !costReport) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800">
        <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Monthly Cost</p>
        <div className="flex items-center gap-2 mt-2">
          <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
          <span className="text-sm text-gray-400">Loading...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !costReport) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800">
        <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Monthly Cost</p>
        <div className="flex items-center gap-2 mt-2">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="text-sm text-red-400">Unavailable</span>
        </div>
      </div>
    );
  }

  const monthly = costReport?.monthly ?? 0;
  const projected = costReport?.projected ?? 0;
  const breakdown = costReport?.breakdown ?? [];

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl p-4 md:p-5 border border-gray-200 dark:border-gray-800 relative cursor-pointer group"
      onClick={() => setShowBreakdown(!showBreakdown)}
      onMouseLeave={() => setShowBreakdown(false)}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs md:text-sm text-gray-600 dark:text-gray-400">Monthly Cost</p>
        <DollarSign className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
      </div>
      <p className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mt-1">
        ~{formatCurrency(monthly)}<span className="text-sm font-normal text-gray-500 dark:text-gray-400">/mo</span>
      </p>
      {projected > 0 && projected !== monthly && (
        <div className="flex items-center gap-1 mt-1">
          <TrendingUp className="w-3 h-3 text-amber-500" />
          <span className="text-xs text-amber-600 dark:text-amber-400">
            ~{formatCurrency(projected)} projected
          </span>
        </div>
      )}

      {/* Breakdown tooltip */}
      {showBreakdown && breakdown.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3 z-50">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Cost Breakdown</p>
          <div className="space-y-1.5">
            {breakdown.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400 truncate mr-2">{item.name}</span>
                <span className="text-gray-900 dark:text-white font-medium whitespace-nowrap">
                  {formatCurrencyFull(item.monthlyCostUsd)}/mo
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2 flex items-center justify-between text-xs">
            <span className="text-gray-500">Accumulated</span>
            <span className="font-medium text-gray-900 dark:text-white">
              {formatCurrencyFull(costReport?.accumulated ?? 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
