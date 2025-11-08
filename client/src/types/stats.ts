export interface AgentStats {
  personal: {
    assignedToMe: number;
    createdByMe: number;
    resolutionRate: number;
    avgResolutionTime: number; // in hours
  };
  team?: Array<{
    teamId: number;
    teamName: string;
    totalTickets: number;
    openTickets: number;
    inProgress: number;
    resolved: number;
    closed: number;
    highPriority: number;
  }>;
}

export interface ManagerStats {
  department: Array<{
    departmentId: number;
    departmentName: string;
    totalTickets: number;
    openTickets: number;
    inProgress: number;
    resolved: number;
    closed: number;
    highPriority: number;
    avgResolutionTime: number;
  }>;
  priorityDistribution: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };
  categoryBreakdown: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  teamPerformance: Array<{
    teamId: number;
    teamName: string;
    totalTickets: number;
    resolutionRate: number;
    avgResolutionTime: number;
    members: Array<{
      userId: string;
      name: string;
      assigned: number;
      resolved: number;
      resolutionRate: number;
      avgResolutionTime: number;
    }>;
  }>;
}
