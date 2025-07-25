import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Brain,
  MessageSquare,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  User,
  Calendar,
  Tag,
  ThumbsUp,
  ThumbsDown,
  Send,
  Sparkles,
  FileText,
  BarChart,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AiResponseFeedback } from "@/components/ai-response-feedback";

interface TicketDetailProps {
  ticketId: number;
  onClose?: () => void;
}

export default function TicketDetail({ ticketId, onClose }: TicketDetailProps) {
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch ticket details
  const { data: ticket, isLoading: ticketLoading } = useQuery({
    queryKey: [`/api/tasks/${ticketId}`],
  });

  // Fetch ticket comments
  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: [`/api/tasks/${ticketId}/comments`],
  });

  // Fetch AI response if available
  const { data: aiResponse } = useQuery({
    queryKey: [`/api/tasks/${ticketId}/auto-response`],
  });

  // Fetch ticket history
  const { data: history } = useQuery({
    queryKey: [`/api/tasks/${ticketId}/history`],
  });

  // Add comment mutation
  const addComment = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/tasks/${ticketId}/comments`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${ticketId}/comments`] });
      setComment("");
      toast({
        title: "Comment added",
        description: "Your comment has been added successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add comment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update AI response effectiveness
  const updateAIEffectiveness = useMutation({
    mutationFn: async (wasHelpful: boolean) => {
      const res = await apiRequest("POST", `/api/tasks/${ticketId}/auto-response/feedback`, { wasHelpful });
      return res.json();
    },
    onSuccess: (_, wasHelpful) => {
      toast({
        title: "Feedback received",
        description: `Thank you for letting us know the AI response was ${wasHelpful ? 'helpful' : 'not helpful'}.`,
      });
    },
  });

  // Apply AI response
  const applyAIResponse = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tasks/${ticketId}/auto-response/apply`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${ticketId}/comments`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${ticketId}/auto-response`] });
      toast({
        title: "AI response applied",
        description: "The AI-generated response has been added to the ticket.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to apply response",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    
    setIsSubmitting(true);
    await addComment.mutateAsync(comment);
    setIsSubmitting(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "status-badge-open";
      case "in_progress":
        return "status-badge-in-progress";
      case "resolved":
        return "status-badge-resolved";
      case "closed":
        return "status-badge-closed";
      case "on_hold":
        return "status-badge-on-hold";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-destructive text-destructive-foreground";
      case "high":
        return "bg-orange-500 text-white";
      case "medium":
        return "bg-yellow-500 text-white";
      case "low":
        return "bg-green-500 text-white";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getConfidenceLevel = (score: number) => {
    if (score >= 0.8) return { label: "High", color: "text-green-600 dark:text-green-400" };
    if (score >= 0.6) return { label: "Medium", color: "text-yellow-600 dark:text-yellow-400" };
    return { label: "Low", color: "text-red-600 dark:text-red-400" };
  };

  if (ticketLoading) {
    return <div className="flex items-center justify-center p-8">Loading ticket details...</div>;
  }

  if (!ticket) {
    return <div className="flex items-center justify-center p-8">Ticket not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Ticket Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold">{ticket.ticketNumber}</h2>
                <Badge className={getStatusColor(ticket.status)}>
                  {ticket.status.replace("_", " ")}
                </Badge>
                <Badge className={getPriorityColor(ticket.priority)}>
                  {ticket.priority}
                </Badge>
              </div>
              <h3 className="text-lg font-semibold">{ticket.title}</h3>
              <p className="text-muted-foreground">{ticket.description}</p>
            </div>
            {onClose && (
              <Button variant="ghost" size="sm" onClick={onClose}>
                <XCircle className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Created by</p>
              <p className="font-medium">{ticket.createdByName || "Unknown"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Created on</p>
              <p className="font-medium">{format(new Date(ticket.createdAt), "MMM d, yyyy h:mm a")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Assigned to</p>
              <p className="font-medium">{ticket.assignedToName || ticket.teamName || "Unassigned"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Category</p>
              <Badge variant="outline">{ticket.category}</Badge>
            </div>
          </div>
          {ticket.tags && ticket.tags.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              {ticket.tags.map((tag: string, index: number) => (
                <Badge key={index} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Response Section */}
      {aiResponse && !aiResponse.wasApplied && (
        <Card className="border-primary/20">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <CardTitle>AI-Generated Response</CardTitle>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Confidence:</span>
                  <span className={cn("font-medium", getConfidenceLevel(aiResponse.confidenceScore).color)}>
                    {getConfidenceLevel(aiResponse.confidenceScore).label} ({(aiResponse.confidenceScore * 100).toFixed(0)}%)
                  </span>
                </div>
                <Progress value={aiResponse.confidenceScore * 100} className="w-24" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Alert className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>AI-Generated Content</AlertTitle>
              <AlertDescription>
                This response was automatically generated by AI with {(aiResponse.confidenceScore * 100).toFixed(0)}% confidence.
                Please review before applying.
              </AlertDescription>
            </Alert>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="whitespace-pre-wrap">{aiResponse.aiResponse}</p>
              </div>
              {aiResponse.suggestedArticles && aiResponse.suggestedArticles.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Related Knowledge Articles:</p>
                  <div className="space-y-2">
                    {aiResponse.suggestedArticles.map((articleId: number) => (
                      <div key={articleId} className="flex items-center gap-2 text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <a href={`/knowledge/${articleId}`} className="text-primary hover:underline">
                          Knowledge Article #{articleId}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mt-4">
                <Button
                  onClick={() => applyAIResponse.mutate()}
                  disabled={applyAIResponse.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Apply Response
                </Button>
                <AiResponseFeedback
                  responseId={aiResponse.id}
                  ticketId={ticketId}
                  feedbackType="auto_response"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Conversation History */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <CardTitle>Conversation History</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {commentsLoading ? (
              <div className="text-center py-4 text-muted-foreground">Loading comments...</div>
            ) : comments && comments.length > 0 ? (
              comments.map((comment: any) => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={comment.user?.profileImageUrl} />
                    <AvatarFallback>
                      {comment.user?.firstName?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {comment.user?.firstName} {comment.user?.lastName}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(comment.createdAt), "MMM d, yyyy h:mm a")}
                      </span>
                      {comment.isAIGenerated && (
                        <Badge variant="secondary" className="text-xs">
                          <Brain className="h-3 w-3 mr-1" />
                          AI
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-4 text-muted-foreground">No comments yet</div>
            )}
          </div>
          <Separator className="my-4" />
          <form onSubmit={handleSubmitComment} className="space-y-4">
            <Textarea
              placeholder="Add a comment..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-h-[100px]"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={isSubmitting || !comment.trim()}>
                <Send className="h-4 w-4 mr-2" />
                Send Comment
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Activity History */}
      {history && history.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <CardTitle>Activity History</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((item: any) => (
                <div key={item.id} className="flex items-start gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                  <div className="flex-1">
                    <span className="font-medium">{item.user?.firstName} {item.user?.lastName}</span>
                    <span className="text-muted-foreground"> {item.action}</span>
                    {item.details && (
                      <span className="text-muted-foreground"> - {item.details}</span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(item.createdAt), "MMM d, yyyy h:mm a")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}