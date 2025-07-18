import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Send, 
  Plus, 
  Clock, 
  User, 
  Users, 
  Calendar, 
  Flag, 
  Tag, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  CircleDot,
  Target,
  Zap
} from "lucide-react";

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task?: any;
}

export default function TaskModal({ isOpen, onClose, task }: TaskModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentTab, setCurrentTab] = useState("details");
  const [commentText, setCommentText] = useState("");
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    priority: "medium",
    status: "open",
    notes: "",
    assigneeId: "",
    assigneeType: "user",
    assigneeTeamId: "",
    dueDate: "",
  });

  // Load teams and users for assignment
  const { data: teams } = useQuery({
    queryKey: ["/api/teams"],
    enabled: isOpen,
  });

  const { data: users } = useQuery({
    queryKey: ["/api/users"],
    enabled: isOpen,
  });

  const { data: taskComments } = useQuery({
    queryKey: ["/api/tasks", task?.id, "comments"],
    enabled: !!task?.id && isOpen,
    retry: false,
  });

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || "",
        description: task.description || "",
        category: task.category || "",
        priority: task.priority || "medium",
        status: task.status || "open",
        notes: task.notes || "",
        assigneeId: task.assigneeId || "",
        assigneeType: task.assigneeType || "user",
        assigneeTeamId: task.assigneeTeamId?.toString() || "",
        dueDate: task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : "",
      });
      setCurrentTab("details");
    } else {
      setFormData({
        title: "",
        description: "",
        category: "",
        priority: "medium",
        status: "open",
        notes: "",
        assigneeId: "",
        assigneeType: "user",
        assigneeTeamId: "",
        dueDate: "",
      });
      setCurrentTab("details");
    }
  }, [task, isOpen]);

  const createTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return await apiRequest("POST", "/api/tasks", taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      onClose();
      toast({
        title: "Success",
        description: "Task created successfully",
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
        description: "Failed to create task",
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async (taskData: any) => {
      return await apiRequest("PATCH", `/api/tasks/${task.id}`, taskData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      if (!formData.notes.trim()) {
        onClose();
      }
      toast({
        title: "Success",
        description: "Task updated successfully",
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
        description: "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async (commentData: any) => {
      return await apiRequest("POST", `/api/tasks/${task.id}/comments`, commentData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", task?.id, "comments"] });
      setCommentText("");
      toast({
        title: "Success",
        description: "Comment added successfully",
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
        description: "Failed to add comment",
        variant: "destructive",
      });
    },
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      toast({
        title: "Error",
        description: "Task title is required",
        variant: "destructive",
      });
      return;
    }

    if (!formData.category) {
      toast({
        title: "Error",
        description: "Task category is required",
        variant: "destructive",
      });
      return;
    }

    const taskData = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      category: formData.category,
      priority: formData.priority,
      status: formData.status,
      notes: formData.notes.trim(),
      assigneeId: formData.assigneeType === "user" ? formData.assigneeId : null,
      assigneeType: formData.assigneeType,
      assigneeTeamId: formData.assigneeType === "team" ? parseInt(formData.assigneeTeamId) : null,
      dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : null,
    };

    if (task) {
      updateTaskMutation.mutate(taskData);
    } else {
      createTaskMutation.mutate(taskData);
    }
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    
    addCommentMutation.mutate({
      content: commentText.trim()
    });
  };

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
      default: return <Tag className="h-4 w-4 text-slate-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "bg-blue-100 text-blue-800 border-blue-200";
      case "in_progress": return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "resolved": return "bg-green-100 text-green-800 border-green-200";
      case "closed": return "bg-slate-100 text-slate-800 border-slate-200";
      case "on_hold": return "bg-orange-100 text-orange-800 border-orange-200";
      default: return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden p-0">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="border-b bg-slate-50 px-6 py-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  {task ? <FileText className="h-5 w-5 text-blue-600" /> : <Plus className="h-5 w-5 text-blue-600" />}
                </div>
                <div className="flex-1">
                  <DialogTitle className="text-xl font-semibold text-slate-900">
                    {task ? `Edit Task ${task.ticketNumber || ''}` : "Create New Task"}
                  </DialogTitle>
                  <DialogDescription className="text-slate-600 mt-1">
                    {task ? "Update the task details and track progress." : "Fill in the details to create a new task for your team."}
                  </DialogDescription>
                </div>
                {task && (
                  <Badge className={`${getStatusColor(task.status)} border`}>
                    {task.status?.replace('_', ' ').toUpperCase()}
                  </Badge>
                )}
              </div>
            </DialogHeader>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <Tabs value={currentTab} onValueChange={setCurrentTab} className="h-full flex flex-col">
              <div className="border-b px-6">
                <TabsList className="bg-transparent h-12 p-0 w-full justify-start">
                  <TabsTrigger 
                    value="details" 
                    className="data-[state=active]:bg-white data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none px-4 py-2"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Task Details
                  </TabsTrigger>
                  {task && (
                    <TabsTrigger 
                      value="comments" 
                      className="data-[state=active]:bg-white data-[state=active]:shadow-sm border-b-2 border-transparent data-[state=active]:border-blue-500 rounded-none px-4 py-2"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Comments {taskComments?.length ? `(${taskComments.length})` : ''}
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              <div className="flex-1 overflow-y-auto">
                <TabsContent value="details" className="mt-0 p-6 space-y-6">
                  <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Essential Information */}
                    <Card className="border-l-4 border-l-blue-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-blue-600" />
                          Essential Information
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div>
                          <Label htmlFor="title" className="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Task Title *
                          </Label>
                          <Input
                            id="title"
                            placeholder="e.g., Fix login page authentication issue"
                            value={formData.title}
                            onChange={(e) => handleInputChange("title", e.target.value)}
                            className="mt-2 text-base"
                            required
                          />
                          <p className="text-xs text-slate-500 mt-1">Be specific and descriptive</p>
                        </div>
                        
                        <div>
                          <Label htmlFor="description" className="text-sm font-medium text-slate-700 flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Description
                          </Label>
                          <Textarea
                            id="description"
                            placeholder="Provide detailed information about the task, requirements, and expected outcomes..."
                            rows={4}
                            value={formData.description}
                            onChange={(e) => handleInputChange("description", e.target.value)}
                            className="mt-2 resize-none"
                          />
                          <p className="text-xs text-slate-500 mt-1">Include context, requirements, and acceptance criteria</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="category" className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <Tag className="h-4 w-4" />
                              Category *
                            </Label>
                            <Select value={formData.category} onValueChange={(value) => handleInputChange("category", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="bug">
                                  <div className="flex items-center gap-2">
                                    {getCategoryIcon("bug")}
                                    Bug Fix
                                  </div>
                                </SelectItem>
                                <SelectItem value="feature">
                                  <div className="flex items-center gap-2">
                                    {getCategoryIcon("feature")}
                                    New Feature
                                  </div>
                                </SelectItem>
                                <SelectItem value="support">
                                  <div className="flex items-center gap-2">
                                    {getCategoryIcon("support")}
                                    Support Request
                                  </div>
                                </SelectItem>
                                <SelectItem value="enhancement">
                                  <div className="flex items-center gap-2">
                                    {getCategoryIcon("enhancement")}
                                    Enhancement
                                  </div>
                                </SelectItem>
                                <SelectItem value="incident">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                                    Incident
                                  </div>
                                </SelectItem>
                                <SelectItem value="request">
                                  <div className="flex items-center gap-2">
                                    <User className="h-4 w-4 text-blue-500" />
                                    Request
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label htmlFor="priority" className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <Flag className="h-4 w-4" />
                              Priority
                            </Label>
                            <Select value={formData.priority} onValueChange={(value) => handleInputChange("priority", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="high">
                                  <div className="flex items-center gap-2">
                                    {getPriorityIcon("high")}
                                    High Priority
                                  </div>
                                </SelectItem>
                                <SelectItem value="medium">
                                  <div className="flex items-center gap-2">
                                    {getPriorityIcon("medium")}
                                    Medium Priority
                                  </div>
                                </SelectItem>
                                <SelectItem value="low">
                                  <div className="flex items-center gap-2">
                                    {getPriorityIcon("low")}
                                    Low Priority
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {/* Status field - only shown when editing existing task */}
                        {task && (
                          <div>
                            <Label htmlFor="status" className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <CircleDot className="h-4 w-4" />
                              Status
                            </Label>
                            <Select value={formData.status} onValueChange={(value) => handleInputChange("status", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">
                                  <div className="flex items-center gap-2">
                                    <CircleDot className="h-4 w-4 text-blue-500" />
                                    Open
                                  </div>
                                </SelectItem>
                                <SelectItem value="in_progress">
                                  <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-yellow-500" />
                                    In Progress
                                  </div>
                                </SelectItem>
                                <SelectItem value="resolved">
                                  <div className="flex items-center gap-2">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                    Resolved
                                  </div>
                                </SelectItem>
                                <SelectItem value="closed">
                                  <div className="flex items-center gap-2">
                                    <CheckCircle className="h-4 w-4 text-slate-500" />
                                    Closed
                                  </div>
                                </SelectItem>
                                <SelectItem value="on_hold">
                                  <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                                    On Hold
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Assignment & Timeline */}
                    <Card className="border-l-4 border-l-green-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Users className="h-5 w-5 text-green-600" />
                          Assignment & Timeline
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <User className="h-4 w-4" />
                              Assignment Type
                            </Label>
                            <Select value={formData.assigneeType} onValueChange={(value) => handleInputChange("assigneeType", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">
                                  <div className="flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    Individual User
                                  </div>
                                </SelectItem>
                                <SelectItem value="team">
                                  <div className="flex items-center gap-2">
                                    <Users className="h-4 w-4" />
                                    Team
                                  </div>
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              Due Date
                            </Label>
                            <Input
                              type="date"
                              value={formData.dueDate}
                              onChange={(e) => handleInputChange("dueDate", e.target.value)}
                              className="mt-2"
                            />
                          </div>
                        </div>

                        {formData.assigneeType === "user" && (
                          <div>
                            <Label className="text-sm font-medium text-slate-700">Assign to User</Label>
                            <Select value={formData.assigneeId} onValueChange={(value) => handleInputChange("assigneeId", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue placeholder="Select user" />
                              </SelectTrigger>
                              <SelectContent>
                                {users?.map((user: any) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    <div className="flex items-center gap-2">
                                      <User className="h-4 w-4" />
                                      {user.firstName && user.lastName 
                                        ? `${user.firstName} ${user.lastName}` 
                                        : user.email}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {formData.assigneeType === "team" && (
                          <div>
                            <Label className="text-sm font-medium text-slate-700">Assign to Team</Label>
                            <Select value={formData.assigneeTeamId} onValueChange={(value) => handleInputChange("assigneeTeamId", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue placeholder="Select team" />
                              </SelectTrigger>
                              <SelectContent>
                                {teams?.map((team: any) => (
                                  <SelectItem key={team.id} value={team.id.toString()}>
                                    <div className="flex items-center gap-2">
                                      <Users className="h-4 w-4" />
                                      {team.name}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {task && (
                          <div>
                            <Label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                              <CircleDot className="h-4 w-4" />
                              Status
                            </Label>
                            <Select value={formData.status} onValueChange={(value) => handleInputChange("status", value)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Open</SelectItem>
                                <SelectItem value="in_progress">In Progress</SelectItem>
                                <SelectItem value="resolved">Resolved</SelectItem>
                                <SelectItem value="closed">Closed</SelectItem>
                                <SelectItem value="on_hold">On Hold</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Additional Notes */}
                    <Card className="border-l-4 border-l-purple-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-lg flex items-center gap-2">
                          <FileText className="h-5 w-5 text-purple-600" />
                          Additional Notes
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Textarea
                          placeholder="Add any additional notes, special instructions, or important details..."
                          rows={3}
                          value={formData.notes}
                          onChange={(e) => handleInputChange("notes", e.target.value)}
                          className="resize-none"
                        />
                      </CardContent>
                    </Card>
                  </form>
                </TabsContent>

                {task && (
                  <TabsContent value="comments" className="mt-0 p-6">
                    <div className="space-y-4">
                      {/* Add Comment */}
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base flex items-center gap-2">
                            <Send className="h-4 w-4" />
                            Add Comment
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <Textarea
                            placeholder="Write your comment..."
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            rows={3}
                            className="resize-none"
                          />
                          <div className="flex justify-end">
                            <Button 
                              onClick={handleAddComment}
                              disabled={!commentText.trim() || addCommentMutation.isPending}
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700"
                            >
                              <Send className="h-4 w-4 mr-2" />
                              {addCommentMutation.isPending ? "Adding..." : "Add Comment"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>

                      {/* Comments List */}
                      <div className="space-y-3">
                        {taskComments?.length > 0 ? (
                          taskComments.map((comment: any) => (
                            <Card key={comment.id} className="border-l-4 border-l-blue-200">
                              <CardContent className="pt-4">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 bg-blue-100 rounded-full">
                                    <User className="h-4 w-4 text-blue-600" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-medium text-slate-900">{comment.userName}</span>
                                      <span className="text-xs text-slate-500">
                                        {new Date(comment.createdAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <p className="text-slate-700">{comment.content}</p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))
                        ) : (
                          <div className="text-center py-8 text-slate-500">
                            <Send className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p>No comments yet. Be the first to add one!</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </div>

          {/* Footer */}
          <div className="border-t bg-slate-50 px-6 py-4">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button 
                onClick={handleSubmit}
                disabled={createTaskMutation.isPending || updateTaskMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {createTaskMutation.isPending || updateTaskMutation.isPending 
                  ? (task ? "Updating..." : "Creating...") 
                  : (task ? "Update Task" : "Create Task")
                }
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}