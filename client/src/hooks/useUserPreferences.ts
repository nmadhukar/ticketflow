import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { UserPreferences, UserPreferencesUpdate } from "@/types/user";
import { useToast } from "@/hooks/use-toast";

/**
 * Hook to fetch user preferences
 */
export function useUserPreferences() {
  const { isAuthenticated } = useAuth();

  return useQuery<UserPreferences>({
    queryKey: ["/api/user/preferences"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/preferences");
      return res.json();
    },
    enabled: isAuthenticated,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to update user preferences
 */
export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: UserPreferencesUpdate) => {
      const res = await apiRequest("PATCH", "/api/user/preferences", updates);
      return res.json();
    },
    onSuccess: (data: UserPreferences) => {
      // Update the cache
      queryClient.setQueryData(["/api/user/preferences"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/user/preferences"] });

      toast({
        title: "Preferences saved",
        description: "Your preferences have been saved successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to save preferences",
        description:
          error?.message || "An error occurred while saving your preferences.",
        variant: "destructive",
      });
    },
  });
}
