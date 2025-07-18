import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Sidebar } from "@/components/sidebar";
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
  Target,
  Zap,
  Star,
  TrendingUp
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MyTasks() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
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
    queryKey: ["/api/tasks/my"],
    retry: false,
    enabled: isAuthenticated,
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
      case "bug": return "bg-red-50 text-red-700 border-red-200";
      case "feature": return "bg-blue-50 text-blue-700 border-blue-200";
      case "support": return "bg-purple-50 text-purple-700 border-purple-200";
      case "enhancement": return "bg-green-50 text-green-700 border-green-200";
      case "incident": return "bg-orange-50 text-orange-700 border-orange-200";
      case "request": return "bg-slate-50 text-slate-700 border-slate-200";
      default: return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "bg-blue-50 text-blue-700 border-blue-200";
      case "in_progress": return "bg-yellow-50 text-yellow-700 border-yellow-200";
      case "resolved": return "bg-green-50 text-green-700 border-green-200";
      case "closed": return "bg-slate-50 text-slate-700 border-slate-200";
      case "on_hold": return "bg-orange-50 text-orange-700 border-orange-200";
      default: return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high": return "bg-red-50 text-red-700 border-red-200";
      case "medium": return "bg-yellow-50 text-yellow-700 border-yellow-200";
      case "low": return "bg-green-50 text-green-700 border-green-200";
      default: return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  const handleEditTask = (task: any) => {
    setEditingTask(task);
    setIsTaskModalOpen(true);
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

  const isDueSoon = (dueDate: string) => {
    if (!dueDate) return false;
    const due = new Date(dueDate);
    const now = new Date();
    const diffInDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return diffInDays <= 3 && diffInDays >= 0;
  };

  // Organize tasks by status for better UX
  const organizedTasks = {
    inProgress: filteredTasks?.filter((t: any) => t.status === "in_progress") || [],
    open: filteredTasks?.filter((t: any) => t.status === "open") || [],
    resolved: filteredTasks?.filter((t: any) => t.status === "resolved") || [],
    closed: filteredTasks?.filter((t: any) => t.status === "closed") || [],
    onHold: filteredTasks?.filter((t: any) => t.status === "on_hold") || []
  };

  const getStatusSection = (status: string, tasks: any[], title: string, icon: any, color: string) => {
    if (tasks.length === 0) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          {icon}
          <h3 className="font-medium text-slate-900">{title}</h3>
          <Badge variant="outline" className={`${color} text-xs`}>
            {tasks.length}
          </Badge>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {tasks.map((task: any) => (
            <TaskCard key={task.id} task={task} onEdit={handleEditTask} />
          ))}
        </div>
      </div>
    );
  };

  const TaskCard = ({ task, onEdit }: { task: any; onEdit: (task: any) => void }) => (
    <Card className="group hover:shadow-md transition-all duration-200 border-0 shadow-sm hover:shadow-lg relative">
      {task.priority === "high" && (
        <div className="absolute top-0 left-0 w-1 h-full bg-red-500 rounded-l-lg"></div>
      )}
      {isOverdue(task.dueDate) && (
        <div className="absolute top-2 right-2">
          <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
            Overdue
          </Badge>
        </div>
      )}
      {isDueSoon(task.dueDate) && !isOverdue(task.dueDate) && (
        <div className="absolute top-2 right-2">
          <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs">
            Due Soon
          </Badge>
        </div>
      )}
      
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-xs font-mono bg-slate-50 text-slate-600">
                {task.ticketNumber}
              </Badge>
              <Badge className={`${getPriorityColor(task.priority)} border text-xs`}>
                <span className="flex items-center gap-1">
                  {getPriorityIcon(task.priority)}
                  {task.priority?.toUpperCase()}
                </span>
              </Badge>
            </div>
            <h3 className="font-semibold text-slate-900 text-base leading-tight line-clamp-2 group-hover:text-blue-600 transition-colors">
              {task.title}
            </h3>
            {task.description && (
              <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                {task.description}
              </p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(task)}>
                <Edit3 className="h-4 w-4 mr-2" />
                Edit Task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-3">
          {/* Status and Category */}
          <div className="flex flex-wrap gap-2">
            <Badge className={`${getStatusColor(task.status)} border text-xs`}>
              {task.status?.replace('_', ' ').toUpperCase()}
            </Badge>
            <Badge className={`${getCategoryColor(task.category)} border text-xs`}>
              <span className="flex items-center gap-1">
                {getCategoryIcon(task.category)}
                {task.category?.toUpperCase()}
              </span>
            </Badge>
          </div>

          {/* Meta Information */}
          <div className="space-y-2 text-xs text-slate-600">
            {task.dueDate && (
              <div className={`flex items-center gap-2 ${isOverdue(task.dueDate) ? 'text-red-600' : isDueSoon(task.dueDate) ? 'text-orange-600' : ''}`}>
                <Calendar className="h-3 w-3" />
                <span>Due {formatDate(task.dueDate)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="h-3 w-3" />
              <span>Created {getTimeAgo(task.createdAt)}</span>
            </div>
            {task.updatedAt !== task.createdAt && (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3" />
                <span>Updated {getTimeAgo(task.updatedAt)}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(task)}
              className="flex-1 h-8 text-xs"
            >
              <Edit3 className="h-3 w-3 mr-1" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(task)}
              className="flex-1 h-8 text-xs"
            >
              <Eye className="h-3 w-3 mr-1" />
              View
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      <Sidebar />
      
      <div className="flex-1 flex flex-col">
        <Header 
          title="My Tasks" 
          subtitle="Track your assigned tasks and personal work items"
          action={
            <Button 
              onClick={() => {
                setEditingTask(null);
                setIsTaskModalOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Task
            </Button>
          }
        />
        
        <main className="flex-1 p-6 overflow-y-auto">
          {/* Enhanced Filters Bar */}
          <Card className="mb-6 border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search your tasks..."
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
                  <span className="text-sm text-slate-600">
                    {filteredTasks?.length || 0} of {tasks?.length || 0} tasks
                  </span>
                  {(filters.search || filters.status !== "all" || filters.category !== "all" || filters.priority !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFilters({ search: "", status: "all", category: "all", priority: "all" })}
                      className="h-7 px-2 text-slate-500 hover:text-slate-700"
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tasks Organized by Status */}
          <div className="space-y-8">
            {tasksLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-6">
                      <div className="space-y-3">
                        <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                        <div className="h-3 bg-slate-200 rounded w-1/2"></div>
                        <div className="flex gap-2">
                          <div className="h-6 bg-slate-200 rounded w-16"></div>
                          <div className="h-6 bg-slate-200 rounded w-16"></div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredTasks?.length > 0 ? (
              <>
                {getStatusSection(
                  "in_progress", 
                  organizedTasks.inProgress, 
                  "In Progress", 
                  <Clock className="h-5 w-5 text-yellow-600" />,
                  "bg-yellow-50 text-yellow-700 border-yellow-200"
                )}
                
                {getStatusSection(
                  "open", 
                  organizedTasks.open, 
                  "Open Tasks", 
                  <CircleDot className="h-5 w-5 text-blue-600" />,
                  "bg-blue-50 text-blue-700 border-blue-200"
                )}
                
                {getStatusSection(
                  "on_hold", 
                  organizedTasks.onHold, 
                  "On Hold", 
                  <AlertTriangle className="h-5 w-5 text-orange-600" />,
                  "bg-orange-50 text-orange-700 border-orange-200"
                )}
                
                {getStatusSection(
                  "resolved", 
                  organizedTasks.resolved, 
                  "Resolved", 
                  <CheckCircle className="h-5 w-5 text-green-600" />,
                  "bg-green-50 text-green-700 border-green-200"
                )}
                
                {getStatusSection(
                  "closed", 
                  organizedTasks.closed, 
                  "Closed", 
                  <CheckCircle className="h-5 w-5 text-slate-600" />,
                  "bg-slate-50 text-slate-700 border-slate-200"
                )}
              </>
            ) : (
              <Card className="border-dashed border-2 border-slate-200">
                <CardContent className="text-center py-12">
                  <div className="max-w-md mx-auto">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Star className="h-8 w-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No tasks assigned</h3>
                    <p className="text-slate-500 mb-6">
                      {filters.search || filters.status !== "all" || filters.category !== "all" || filters.priority !== "all"
                        ? "Try adjusting your filters to see more tasks."
                        : "You don't have any tasks assigned yet. Create one or get assigned to existing tasks."}
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
                        Create New Task
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
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
    </div>
  );
}