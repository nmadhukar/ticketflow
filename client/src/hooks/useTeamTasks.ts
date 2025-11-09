import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import type { Task, TeamTaskAssignment } from "@/types/teams";

/**
 * Hook to fetch all tasks assigned to a team
 */
export function useTeamTasks(teamId: string | number | undefined) {
  return useQuery<Task[]>({
    queryKey: ["/api/teams", teamId, "tasks"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/teams/${teamId}/tasks`);
      return res.json();
    },
    enabled: !!teamId,
    retry: false,
  });
}

/**
 * Hook to fetch all assignments for a specific team task
 */
export function useTaskAssignments(
  teamId: string | number | undefined,
  taskId: string | number | undefined
) {
  return useQuery<TeamTaskAssignment[]>({
    queryKey: ["/api/teams", teamId, "tasks", taskId, "assignments"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/teams/${teamId}/tasks/${taskId}/assignments`
      );
      return res.json();
    },
    enabled: !!teamId && !!taskId,
    retry: false,
  });
}

/**
 * Hook to create a task assignment
 */
export function useCreateTaskAssignment(
  teamId: string | number | undefined,
  taskId: string | number | undefined
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: {
      userId: string;
      notes?: string;
      priority?: string;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/teams/${teamId}/tasks/${taskId}/assignments`,
        data
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "tasks", taskId, "assignments"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "tasks"],
      });
      toast({
        title: "Success",
        description: "Task assigned to team member",
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
        description: "Failed to assign task",
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to update a task assignment
 */
export function useUpdateTaskAssignment(
  teamId: string | number | undefined,
  taskId: string | number | undefined,
  assignmentId: number | undefined
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: {
      status?: string;
      notes?: string;
      priority?: string;
    }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/teams/${teamId}/tasks/${taskId}/assignments/${assignmentId}`,
        updates
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "tasks", taskId, "assignments"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "tasks"],
      });
      toast({
        title: "Success",
        description: "Assignment updated",
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
        description: "Failed to update assignment",
        variant: "destructive",
      });
    },
  });
}

/**
 * Hook to delete a task assignment
 */
export function useDeleteTaskAssignment(
  teamId: string | number | undefined,
  taskId: string | number | undefined,
  assignmentId: number | undefined
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "DELETE",
        `/api/teams/${teamId}/tasks/${taskId}/assignments/${assignmentId}`
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "tasks", taskId, "assignments"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/teams", teamId, "tasks"],
      });
      toast({
        title: "Success",
        description: "Assignment removed",
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
        description: "Failed to remove assignment",
        variant: "destructive",
      });
    },
  });
}

