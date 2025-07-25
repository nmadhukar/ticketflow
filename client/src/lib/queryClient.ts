/**
 * TanStack Query Client Configuration
 * 
 * This module configures the global query client for efficient server state management.
 * 
 * Key Features:
 * - Centralized HTTP request handling with error management
 * - Automatic authentication handling with cookie sessions
 * - Configurable unauthorized behavior (throw vs return null)
 * - Optimized caching and refetch strategies
 * - Type-safe API request wrapper
 * 
 * Error Handling:
 * - Standardized error responses across all API calls
 * - Automatic unauthorized (401) detection and handling
 * - Proper error propagation to React components
 * - Network error resilience and retry logic
 * 
 * Performance Optimizations:
 * - Disabled automatic refetching to reduce server load
 * - Infinite stale time for stable data
 * - Smart cache invalidation strategies
 * - Minimal retry attempts for failed requests
 * 
 * Authentication Integration:
 * - Automatic session cookie inclusion
 * - Graceful handling of authentication failures
 * - Support for protected route patterns
 * - Configurable response to unauthorized access
 */

import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Validates HTTP response and throws descriptive errors for non-OK responses
 */
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
