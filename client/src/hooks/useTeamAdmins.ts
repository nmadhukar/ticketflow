import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { TeamAdmin, TeamPermissions } from "@/types/teams";

/**
 * Hook to fetch team admins for a specific team
 */
export function useTeamAdmins(teamId: string | number | undefined) {
  return useQuery<TeamAdmin[]>({
    queryKey: ["/api/teams", teamId, "admins"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/teams/${teamId}/admins`);
      return res.json();
    },
    enabled: !!teamId,
    retry: false,
  });
}

/**
 * Hook to fetch current user's permissions for a team
 */
export function useTeamPermissions(teamId: string | number | undefined) {
  return useQuery<TeamPermissions>({
    queryKey: ["/api/teams", teamId, "permissions"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/teams/${teamId}/permissions`);
      return res.json();
    },
    enabled: !!teamId,
    retry: false,
  });
}

/**
 * Hook to grant team admin status to a member
 */
export function useGrantTeamAdmin(teamId: string | number | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiRequest("POST", `/api/teams/${teamId}/admins`, {
        memberId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "admins"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "members"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "permissions"],
      });
      toast({
        title: "Success",
        description: "Team admin status granted",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to grant team admin status",
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to revoke team admin status from a member
 */
export function useRevokeTeamAdmin(teamId: string | number | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (adminId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/teams/${teamId}/admins/${adminId}`
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "admins"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "members"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "permissions"],
      });
      toast({
        title: "Success",
        description: "Team admin status revoked",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to revoke team admin status",
        variant: "destructive",
      });
    },
  });
}

