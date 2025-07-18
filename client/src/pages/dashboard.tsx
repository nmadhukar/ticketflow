import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useLocation } from "wouter";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import StatsCard from "@/components/stats-card";
import TaskCard from "@/components/task-card";
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
  UserCheck
} from "lucide-react";

export default function Dashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

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

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "bg-red-500";
      case "medium": return "bg-yellow-500";
      case "low": return "bg-green-500";
      default: return "bg-slate-300";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "bug": return "bg-red-100 text-red-800";
      case "feature": return "bg-blue-100 text-blue-800";
      case "support": return "bg-purple-100 text-purple-800";
      case "enhancement": return "bg-green-100 text-green-800";
      default: return "bg-slate-100 text-slate-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "bg-blue-100 text-blue-800";
      case "in_progress": return "bg-yellow-100 text-yellow-800";
      case "resolved": return "bg-green-100 text-green-800";
      case "closed": return "bg-slate-100 text-slate-800";
      default: return "bg-slate-100 text-slate-800";
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Sidebar />
      
      <div className="flex-1 flex flex-col">
        <Header title="Dashboard" subtitle="Welcome back! Here's your task overview." />
        
        <main className="flex-1 p-6 overflow-y-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatsCard
              title="Total Tasks"
              value={stats?.total || 0}
              icon={<BarChart3 className="text-blue-600" />}
              loading={statsLoading}
            />
            <StatsCard
              title="In Progress"
              value={stats?.inProgress || 0}
              icon={<Clock className="text-yellow-600" />}
              loading={statsLoading}
            />
            <StatsCard
              title="Completed"
              value={(stats?.resolved || 0) + (stats?.closed || 0)}
              icon={<CheckCircle className="text-green-600" />}
              loading={statsLoading}
            />
            <StatsCard
              title="High Priority"
              value={stats?.highPriority || 0}
              icon={<AlertTriangle className="text-red-600" />}
              loading={statsLoading}
            />
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent Tasks */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Recent Tasks</CardTitle>
                    <div className="flex items-center space-x-3">
                      <div className="relative">
                        <Input
                          placeholder="Search tasks..."
                          className="w-64 pl-10"
                        />
                        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                      </div>
                      <Button variant="outline" size="sm">
                        <Filter className="h-4 w-4 mr-2" />
                        Filter
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {tasksLoading ? (
                    <div className="text-center py-8">Loading tasks...</div>
                  ) : recentTasks && recentTasks.length > 0 ? (
                    recentTasks.slice(0, 5).map((task: any) => (
                      <div key={task.id} className="flex items-center space-x-4 p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer" onClick={() => setLocation("/tasks")}>
                        <div className={`w-3 h-3 rounded-full ${getPriorityColor(task.priority)}`} />
                        <div className="flex-1">
                          <h4 className="font-medium text-slate-800">{task.title}</h4>
                          <p className="text-sm text-slate-600">{task.description}</p>
                          <div className="flex items-center space-x-4 mt-2">
                            <Badge className={getCategoryColor(task.category)}>
                              {task.category}
                            </Badge>
                            {task.assigneeId && (
                              <span className="text-sm text-slate-500">
                                Assigned to: {task.assigneeId}
                              </span>
                            )}
                            {task.dueDate && (
                              <span className="text-sm text-slate-500">
                                Due: {new Date(task.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge className={getStatusColor(task.status)}>
                          {task.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      No tasks found. Create your first task to get started!
                    </div>
                  )}
                  
                  <div className="pt-6 border-t">
                    <Button variant="ghost" className="w-full text-blue-600 hover:text-blue-700" onClick={() => setLocation("/tasks")}>
                      View All Tasks
                    </Button>
                  </div>
                </CardContent>
              </Card>
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
                      <div key={item.id} className="flex space-x-3">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          {item.action === 'created' && <Plus className="h-4 w-4 text-blue-600" />}
                          {item.action === 'completed' && <CheckCircle className="h-4 w-4 text-green-600" />}
                          {item.action === 'commented' && <MessageCircle className="h-4 w-4 text-yellow-600" />}
                          {item.action === 'updated' && <UserCheck className="h-4 w-4 text-purple-600" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-slate-800">
                            <span className="font-medium">{item.userId}</span> {item.action} a task
                          </p>
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
    </div>
  );
}
