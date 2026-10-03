import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * Ends the server session and forgets what was cached for the signed-in user. Throws when
 * the request fails (the caller decides what to show). The one sign-out request for the
 * whole client: the header menu (useAuth.logout) and the forced password-change screen both use it.
 */
export async function signOutRequest(queryClient: QueryClient): Promise<void> {
  await apiRequest("POST", "/api/auth/logout");
  // A refetch would 401 yet keep the previous user in the cache, so mark the user
  // signed out directly and drop everything else cached.
  queryClient.setQueryData(["/api/auth/user"], null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/auth/user" });
}

/**
 * Leaves for the landing page with a full page load: every in-memory state goes, and a
 * deep path (a ticket URL) does not land on NotFound once the user is signed out.
 */
export function goHome(): void {
  window.location.href = "/";
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: () => signOutRequest(queryClient),
    onSuccess: () => {
      // Clear all queries and redirect to home
      queryClient.clear();
      goHome();
    },
    onError: (error) => {
      console.error("Logout error:", error);
      // Still redirect to home even if there's an error
      goHome();
    }
  });

  const logout = () => {
    logoutMutation.mutate();
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout,
    isLoggingOut: logoutMutation.isPending,
  };
}
