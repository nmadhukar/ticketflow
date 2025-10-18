import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import Header from "@/components/header";
import TaskModal from "@/components/task-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Calendar, 
  User, 
  Clock, 
  AlertTriangle,
  CheckCircle,
  CircleDot,
  Tag,
  Users,
  FileText,
  Eye,
  Edit3,
  Trash2,
  Target,
  Zap
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Tasks() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [viewMode, setViewMode] = useState("cards"); // cards or table
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    category: "all",
    priority: "all",
  });

  // Redirect if not authenticated
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

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["/api/tasks"],
    retry: false,
    enabled: isAuthenticated,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await apiRequest("DELETE", `/api/tasks/${taskId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Success",
        description: "Task deleted successfully",
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
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "high": return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "medium": return <CircleDot className="h-4 w-4 text-yellow-500" />;
      case "low": return <CheckCircle className="h-4 w-4 text-green-500" />;
      default: return <CircleDot className="h-4 w-4 text-slate-400" />;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "bug": return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case "feature": return <Zap className="h-4 w-4 text-blue-500" />;
      case "support": return <User className="h-4 w-4 text-purple-500" />;
      case "enhancement": return <Target className="h-4 w-4 text-green-500" />;
      case "incident": return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "request": return <FileText className="h-4 w-4 text-blue-500" />;
      default: return <Tag className="h-4 w-4 text-slate-400" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "bug": return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 border-red-200 dark:border-red-800";
      case "feature": return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200 dark:border-blue-800";
      case "support": return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400 border-purple-200 dark:border-purple-800";
      case "enhancement": return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800";
      case "incident": return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400 border-orange-200 dark:border-orange-800";
      case "request": return "bg-muted text-muted-foreground border-border";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "status-badge-open";
      case "in_progress": return "status-badge-in-progress";
      case "resolved": return "status-badge-resolved";
      case "closed": return "status-badge-closed";
      case "on_hold": return "status-badge-on-hold";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "bg-destructive text-destructive-foreground border-destructive";
      case "high": return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400 border-orange-200 dark:border-orange-800";
      case "medium": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800";
      case "low": return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400 border-green-200 dark:border-green-800";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  const handleEditTask = (task: any) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
  };

  const handleDeleteTask = (taskId: number) => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTaskMutation.mutate(taskId);
    }
  };

  const filteredTasks = tasks?.filter((task: any) => {
    if (filters.search && !task.title.toLowerCase().includes(filters.search.toLowerCase()) && 
        !task.description?.toLowerCase().includes(filters.search.toLowerCase()) &&
        !task.ticketNumber?.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    if (filters.status && filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.category && filters.category !== "all" && task.category !== filters.category) return false;
    if (filters.priority && filters.priority !== "all" && task.priority !== filters.priority) return false;
    return true;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return formatDate(dateString);
  };

  const isOverdue = (dueDate: string) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  return (
    <>
      <div className="flex-1 flex flex-col">
        <Header 
          title="All Tickets" 
          subtitle="Manage and track all tickets across your projects"
          action={
            <Button 
              onClick={() => {
                setEditingTask(null);
                setIsTaskModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Ticket
            </Button>
          }
        />
        
        <main className="flex-1 p-6 overflow-y-auto">
          {/* Enhanced Filters Bar */}
          <Card className="mb-6 shadow-business">
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by title, description, or ticket number..."
                    value={filters.search}
                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    className="pl-10 h-10"
                  />
                </div>
                
                {/* Filter Controls */}
                <div className="flex gap-3">
                  <Select value={filters.status} onValueChange={(value) => setFilters(prev => ({ ...prev, status: value }))}>
                    <SelectTrigger className="w-[140px] h-10">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="on_hold">On Hold</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filters.category} onValueChange={(value) => setFilters(prev => ({ ...prev, category: value }))}>
                    <SelectTrigger className="w-[140px] h-10">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="bug">Bug</SelectItem>
                      <SelectItem value="feature">Feature</SelectItem>
                      <SelectItem value="support">Support</SelectItem>
                      <SelectItem value="enhancement">Enhancement</SelectItem>
                      <SelectItem value="incident">Incident</SelectItem>
                      <SelectItem value="request">Request</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filters.priority} onValueChange={(value) => setFilters(prev => ({ ...prev, priority: value }))}>
                    <SelectTrigger className="w-[140px] h-10">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priorities</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Active Filters & Stats */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {filteredTasks?.length || 0} of {tasks?.length || 0} tickets
                  </span>
                  {(filters.search || filters.status !== "all" || filters.category !== "all" || filters.priority !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFilters({ search: "", status: "all", category: "all", priority: "all" })}
                      className="h-7 px-2"
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tasks Table */}
          <Card className="shadow-business">
            <CardContent className="p-0">
              {tasksLoading ? (
                <div className="animate-pulse p-6">
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-12 bg-slate-100 rounded"></div>
                    ))}
                  </div>
                </div>
              ) : filteredTasks?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50 border-b">
                      <tr>
                        <th className="text-left p-4 font-medium">Ticket</th>
                        <th className="text-left p-4 font-medium">Title</th>
                        <th className="text-left p-4 font-medium">Priority</th>
                        <th className="text-left p-4 font-medium">Status</th>
                        <th className="text-left p-4 font-medium">Category</th>
                        <th className="text-left p-4 font-medium">Assigned To</th>
                        <th className="text-left p-4 font-medium">Due Date</th>
                        <th className="text-left p-4 font-medium">Created</th>
                        <th className="text-center p-4 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredTasks.map((task: any) => (
                        <tr key={task.id} className="hover:bg-muted/50 transition-colors">
                          <td className="p-4">
                            <Badge variant="outline" className="font-mono text-xs">
                              {task.ticketNumber}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <div>
                              <p 
                                className="font-medium line-clamp-1 cursor-pointer hover:text-primary hover:underline"
                                onClick={() => handleEditTask(task)}
                              >
                                {task.title}
                              </p>
                              {task.description && (
                                <p className="text-sm text-muted-foreground line-clamp-1 mt-1">{task.description}</p>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            <Badge className={`${getPriorityColor(task.priority)} border`}>
                              <span className="flex items-center gap-1">
                                {getPriorityIcon(task.priority)}
                                {task.priority?.toUpperCase()}
                              </span>
                            </Badge>
                          </td>
                          <td className="p-4">
                            <Badge className={`${getStatusColor(task.status)} border`}>
                              {task.status?.replace('_', ' ').toUpperCase()}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <Badge className={`${getCategoryColor(task.category)} border`}>
                              <span className="flex items-center gap-1">
                                {getCategoryIcon(task.category)}
                                {task.category?.toUpperCase()}
                              </span>
                            </Badge>
                          </td>
                          <td className="p-4">
                            {task.assigneeId ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                {task.assigneeType === "team" ? (
                                  <Users className="h-4 w-4" />
                                ) : (
                                  <User className="h-4 w-4" />
                                )}
                                <span>{task.assigneeName || task.assigneeId}</span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">Unassigned</span>
                            )}
                          </td>
                          <td className="p-4">
                            {task.dueDate ? (
                              <div className={`text-sm ${isOverdue(task.dueDate) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                {formatDate(task.dueDate)}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">No due date</span>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="text-sm text-muted-foreground">
                              <div>{task.creatorName || 'Unknown'}</div>
                              <div className="text-xs">{getTimeAgo(task.createdAt)}</div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditTask(task)}
                                className="h-8 w-8 p-0"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEditTask(task)}>
                                    <Edit3 className="h-4 w-4 mr-2" />
                                    Edit Ticket
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDeleteTask(task.id)} className="text-red-600">
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete Ticket
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="max-w-md mx-auto">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <FileText className="h-8 w-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No tickets found</h3>
                    <p className="text-slate-500 mb-6">
                      {filters.search || filters.status !== "all" || filters.category !== "all" || filters.priority !== "all"
                        ? "Try adjusting your filters to see more tickets."
                        : "Get started by creating your first ticket."}
                    </p>
                    {!filters.search && filters.status === "all" && filters.category === "all" && filters.priority === "all" && (
                      <Button 
                        onClick={() => {
                          setEditingTask(null);
                          setIsTaskModalOpen(true);
                        }}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create First Ticket
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={() => {
          setIsTaskModalOpen(false);
          setEditingTask(null);
        }}
        task={editingTask}
      />
    </>
  );
}
