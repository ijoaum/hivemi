"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// Global cache for API responses - persists across page navigations
const apiCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 10000; // 10 seconds

interface UseApiOptions<T> {
  initialData?: T;
  refetchInterval?: number;
  cacheKey?: string;
}

interface UseApiResult<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  options: UseApiOptions<T> = {}
): UseApiResult<T> {
  // Check cache for initial data
  const cachedEntry = options.cacheKey ? apiCache.get(options.cacheKey) : null;
  const cachedData = cachedEntry && (Date.now() - cachedEntry.timestamp < CACHE_TTL) 
    ? cachedEntry.data as T 
    : undefined;

  const [data, setData] = useState<T | undefined>(options.initialData ?? cachedData);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!options.initialData && !cachedData);
  const hasFetchedOnce = useRef(!!cachedData);

  const refetch = useCallback(async () => {
    try {
      if (!hasFetchedOnce.current) {
        setIsLoading(true);
      }
      setError(null);
      const result = await fetcher();
      setData(result);
      hasFetchedOnce.current = true;
      
      // Update cache
      if (options.cacheKey) {
        apiCache.set(options.cacheKey, { data: result, timestamp: Date.now() });
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher, options.cacheKey]);

  useEffect(() => {
    refetch();

    if (options.refetchInterval) {
      const interval = setInterval(refetch, options.refetchInterval);
      return () => clearInterval(interval);
    }
  }, [refetch, options.refetchInterval]);

  return { data, error, isLoading, loading: isLoading, refetch };
}
