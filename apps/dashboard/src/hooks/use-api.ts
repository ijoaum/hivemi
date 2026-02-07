"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UseApiOptions<T> {
  initialData?: T;
  refetchInterval?: number;
}

interface UseApiResult<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  loading: boolean; // alias for isLoading - only true on first load
  refetch: () => Promise<void>;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  options: UseApiOptions<T> = {}
): UseApiResult<T> {
  const [data, setData] = useState<T | undefined>(options.initialData);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!options.initialData);
  const hasFetchedOnce = useRef(false);

  const refetch = useCallback(async () => {
    try {
      // Only show loading on first fetch
      if (!hasFetchedOnce.current) {
        setIsLoading(true);
      }
      setError(null);
      const result = await fetcher();
      setData(result);
      hasFetchedOnce.current = true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    refetch();

    if (options.refetchInterval) {
      const interval = setInterval(refetch, options.refetchInterval);
      return () => clearInterval(interval);
    }
  }, [refetch, options.refetchInterval]);

  return { data, error, isLoading, loading: isLoading, refetch };
}
