import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useLocation, useParams } from "wouter";
import Header from "@/components/header";
import StatsCard from "@/components/stats-card";
import TaskCard from "@/components/task-card";
import TicketList from "@/components/ticket-list";
import TicketDetail from "@/components/ticket-detail";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  BarChart3, 
  Search, 
  Filter, 
  Plus,
  MessageCircle,
  UserCheck,
  Brain,
  Book
} from "lucide-react";
import TaskModal from "@/components/task-modal";
import { useWebSocketContext } from "@/hooks/useWebSocket";



export default function Dashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const params = useParams();
  const { isConnected } = useWebSocketContext();
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  
  // If there's a ticket ID in the URL, show ticket detail view
  const ticketId = params?.id ? parseInt(params.id) : null;

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/stats"],
    retry: false,
    enabled: isAuthenticated,
  });

  const { data: recentTasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["/api/tasks"],
    retry: false,
    enabled: isAuthenticated,
  });

  const { data: teamMembers, isLoading: membersLoading } = useQuery({
    queryKey: ["/api/teams/my"],
    retry: false,
    enabled: isAuthenticated,
  });

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ["/api/activity"],
    retry: false,
    enabled: isAuthenticated,
  });

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  // Filter tasks based on current filters
  const filteredTasks = recentTasks?.filter((task: any) => {
    if (statusFilter) {
      if (statusFilter === "completed") {
        if (task.status !== "resolved" && task.status !== "closed") return false;
      } else if (task.status !== statusFilter) {
        return false;
      }
    }
    if (priorityFilter && task.priority !== priorityFilter) return false;
    return true;
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "bg-destructive";
      case "high": return "bg-orange-500";
      case "medium": return "bg-yellow-500";
      case "low": return "bg-green-500";
      default: return "bg-muted";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "bug": return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400";
      case "feature": return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
      case "support": return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400";
      case "enhancement": return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "status-badge-open";
      case "in_progress": return "status-badge-in-progress";
      case "resolved": return "status-badge-resolved";
      case "closed": return "status-badge-closed";
      case "on_hold": return "status-badge-on-hold";
      default: return "bg-muted text-muted-foreground";
    }
  };

  // If viewing a specific ticket, show ticket detail view
  if (ticketId) {
    return (
      <div className="flex-1 flex flex-col">
        <Header title="Ticket Details" subtitle="View and manage ticket information" />
        <main className="flex-1 p-6 overflow-y-auto">
          <TicketDetail ticketId={ticketId} onClose={() => setLocation("/")} />
        </main>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex flex-col">
        <Header title="Dashboard" subtitle="Welcome back! Here's your ticket overview." />
        
        <main className="flex-1 p-6 overflow-y-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div 
              onClick={() => {
                setStatusFilter(null);
                setPriorityFilter(null);
              }}
              className="cursor-pointer transform transition-transform hover:scale-105"
            >
              <StatsCard
                title="Total Tickets"
                value={stats?.total || 0}
                icon={<BarChart3 className="text-blue-600" />}
                loading={statsLoading}
                isActive={!statusFilter && !priorityFilter}
              />
            </div>
            <div 
              onClick={() => {
                setStatusFilter("in_progress");
                setPriorityFilter(null);
              }}
              className="cursor-pointer transform transition-transform hover:scale-105"
            >
              <StatsCard
                title="In Progress"
                value={stats?.inProgress || 0}
                icon={<Clock className="text-yellow-600" />}
                loading={statsLoading}
                isActive={statusFilter === "in_progress"}
              />
            </div>
            <div 
              onClick={() => {
                setStatusFilter("completed");
                setPriorityFilter(null);
              }}
              className="cursor-pointer transform transition-transform hover:scale-105"
            >
              <StatsCard
                title="Completed"
                value={(stats?.resolved || 0) + (stats?.closed || 0)}
                icon={<CheckCircle className="text-green-600" />}
                loading={statsLoading}
                isActive={statusFilter === "completed"}
              />
            </div>
            <div 
              onClick={() => {
                setStatusFilter(null);
                setPriorityFilter("high");
              }}
              className="cursor-pointer transform transition-transform hover:scale-105"
            >
              <StatsCard
                title="High Priority"
                value={stats?.highPriority || 0}
                icon={<AlertTriangle className="text-red-600" />}
                loading={statsLoading}
                isActive={priorityFilter === "high"}
              />
            </div>
          </div>

          {/* WebSocket Connection Status */}
          {isConnected && (
            <div className="mb-4 flex items-center gap-2 text-sm text-green-600">
              <div className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
              Real-time updates active
            </div>
          )}

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Ticket List */}
            <div className="lg:col-span-2">
              <TicketList 
                onTicketSelect={(ticket) => setLocation(`/tickets/${ticket.id}`)}
                showAIInfo={true}
                allowDragDrop={true}
              />
            </div>
            
            {/* Sidebar Content */}
            <div className="space-y-6">
              {/* Team Members */}
              <Card>
                <CardHeader>
                  <CardTitle>Team Members</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {membersLoading ? (
                    <div className="text-center py-4">Loading team members...</div>
                  ) : teamMembers && teamMembers.length > 0 ? (
                    teamMembers.slice(0, 5).map((team: any) => (
                      <div key={team.id} className="flex items-center space-x-3">
                        <Avatar>
                          <AvatarImage src="/placeholder-avatar.jpg" />
                          <AvatarFallback>{team.name?.charAt(0) || 'T'}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="font-medium text-slate-800">{team.name}</p>
                          <p className="text-sm text-slate-600">{team.description || 'Team'}</p>
                        </div>
                        <div className="w-3 h-3 bg-green-500 rounded-full" />
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4 text-slate-500">
                      No team members found.
                    </div>
                  )}
                </CardContent>
              </Card>
              
              {/* Recent Activity */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Activity</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activityLoading ? (
                    <div className="text-center py-4">Loading activity...</div>
                  ) : activity && activity.length > 0 ? (
                    activity.slice(0, 5).map((item: any) => (
                      <div 
                        key={item.id} 
                        className="flex space-x-3 cursor-pointer hover:bg-muted/30 p-2 rounded-md transition-colors"
                        onClick={() => {
                          // Find the task in recentTasks based on taskId
                          const task = recentTasks?.find((t: any) => t.id === item.taskId);
                          if (task) {
                            setSelectedTask(task);
                            setIsTaskModalOpen(true);
                          }
                        }}
                      >
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          {item.action === 'created' && <Plus className="h-4 w-4 text-blue-600" />}
                          {item.action === 'completed' && <CheckCircle className="h-4 w-4 text-green-600" />}
                          {item.action === 'commented' && <MessageCircle className="h-4 w-4 text-yellow-600" />}
                          {item.action === 'updated' && <UserCheck className="h-4 w-4 text-purple-600" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-slate-800">
                            <span className="font-medium">{item.userName || item.userId}</span> {item.action} a ticket
                          </p>
                          {item.taskTitle && (
                            <p className="text-xs text-muted-foreground font-medium hover:text-primary">
                              {item.taskTitle}
                            </p>
                          )}
                          <p className="text-xs text-slate-500">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-4 text-slate-500">
                      No recent activity.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </main>
      </div>
      
      
      {/* Ticket Modal */}
      {selectedTask && (
        <TaskModal
          task={selectedTask}
          isOpen={isTaskModalOpen}
          onClose={() => {
            setIsTaskModalOpen(false);
            setSelectedTask(null);
          }}
          onUpdate={() => {
            // Refetch tasks when updated
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
