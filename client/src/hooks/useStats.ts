import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import type { AgentStats, ManagerStats } from "@/types/stats";

export function useAgentStats() {
  const { user } = useAuth();
  const userId = (user as any)?.id;
  const role = (user as any)?.role;

  return useQuery<AgentStats>({
    queryKey: ["/api/stats/agent"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stats/agent");
      return res.json();
    },
    enabled: !!userId && role === "agent",
    refetchInterval: 30000, // 30 seconds
    staleTime: 10000, // 10 seconds
  });
}

export function useManagerStats() {
  const { user } = useAuth();
  const userId = (user as any)?.id;
  const role = (user as any)?.role;

  return useQuery<ManagerStats>({
    queryKey: ["/api/stats/manager"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/stats/manager");
      return res.json();
    },
    enabled: !!userId && role === "manager",
    refetchInterval: 30000, // 30 seconds
    staleTime: 10000, // 10 seconds
  });
}
