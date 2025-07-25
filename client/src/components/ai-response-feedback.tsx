import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AiResponseFeedbackProps {
  responseId: number;
  ticketId: number;
  feedbackType: "auto_response" | "knowledge_article";
  className?: string;
}

export function AiResponseFeedback({
  responseId,
  ticketId,
  feedbackType,
  className,
}: AiResponseFeedbackProps) {
  const { toast } = useToast();
  const [showCommentDialog, setShowCommentDialog] = useState(false);
  const [pendingRating, setPendingRating] = useState<1 | 5 | null>(null);
  const [comment, setComment] = useState("");
  const [existingFeedback, setExistingFeedback] = useState<number | null>(null);

  const submitFeedbackMutation = useMutation({
    mutationFn: async (data: {
      rating: 1 | 5;
      comment?: string;
    }) => {
      await apiRequest("POST", "/api/ai-feedback", {
        feedbackType,
        referenceId: responseId,
        rating: data.rating,
        comment: data.comment,
        ticketId,
      });
    },
    onSuccess: (_, variables) => {
      setExistingFeedback(variables.rating);
      setShowCommentDialog(false);
      setComment("");
      setPendingRating(null);
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ["/api/ai-feedback", feedbackType, responseId] });
      
      toast({
        title: "Feedback submitted",
        description: "Thank you for helping us improve!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to submit feedback",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFeedback = (rating: 1 | 5) => {
    if (rating === 1) {
      // For thumbs down, show comment dialog
      setPendingRating(rating);
      setShowCommentDialog(true);
    } else {
      // For thumbs up, submit immediately
      submitFeedbackMutation.mutate({ rating });
    }
  };

  const handleSubmitWithComment = () => {
    if (pendingRating) {
      submitFeedbackMutation.mutate({
        rating: pendingRating,
        comment: comment.trim() || undefined,
      });
    }
  };

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-sm text-muted-foreground">Was this helpful?</span>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={existingFeedback === 5 ? "default" : "ghost"}
            className="h-8 w-8 p-0"
            onClick={() => handleFeedback(5)}
            disabled={submitFeedbackMutation.isPending}
          >
            <ThumbsUp className={cn(
              "h-4 w-4",
              existingFeedback === 5 && "fill-current"
            )} />
            <span className="sr-only">Helpful</span>
          </Button>
          <Button
            size="sm"
            variant={existingFeedback === 1 ? "default" : "ghost"}
            className="h-8 w-8 p-0"
            onClick={() => handleFeedback(1)}
            disabled={submitFeedbackMutation.isPending}
          >
            <ThumbsDown className={cn(
              "h-4 w-4",
              existingFeedback === 1 && "fill-current"
            )} />
            <span className="sr-only">Not helpful</span>
          </Button>
        </div>
      </div>

      <Dialog open={showCommentDialog} onOpenChange={setShowCommentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Help us improve</DialogTitle>
            <DialogDescription>
              What could we do better? Your feedback helps us learn and provide better responses.
            </DialogDescription>
          </DialogHeader>
          
          <Textarea
            placeholder="Tell us what went wrong or how we can improve..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="min-h-[100px]"
          />
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCommentDialog(false);
                setComment("");
                setPendingRating(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmitWithComment}
              disabled={submitFeedbackMutation.isPending}
            >
              Submit Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}