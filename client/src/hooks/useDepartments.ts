import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Department } from "@shared/schema";

/**
 * Team interface for department teams response
 */
export interface DepartmentTeam {
  id: number;
  name: string;
  description: string | null;
  createdAt: string | Date;
  createdBy: string | null;
}

/**
 * Department statistics interface
 */
export interface DepartmentStats {
  teamCount: number;
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  closedTickets: number;
  highPriorityTickets: number;
}

/**
 * Hook to fetch a single department by ID
 */
export function useDepartment(departmentId: string | number | undefined) {
  return useQuery<Department>({
    queryKey: ["/api/departments", departmentId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/departments/${departmentId}`);
      return res.json();
    },
    enabled: !!departmentId,
    retry: false,
  });
}

/**
 * Hook to fetch all teams in a department
 */
export function useDepartmentTeams(departmentId: string | number | undefined) {
  return useQuery<DepartmentTeam[]>({
    queryKey: ["/api/departments", departmentId, "teams"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/departments/${departmentId}/teams`
      );
      return res.json();
    },
    enabled: !!departmentId,
    retry: false,
  });
}

/**
 * Hook to fetch department statistics
 */
export function useDepartmentStats(departmentId: string | number | undefined) {
  return useQuery<DepartmentStats>({
    queryKey: ["/api/departments", departmentId, "stats"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/departments/${departmentId}/stats`
      );
      return res.json();
    },
    enabled: !!departmentId,
    retry: false,
  });
}
