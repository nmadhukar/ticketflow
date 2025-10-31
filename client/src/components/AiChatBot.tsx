/**
 * AI Help Chatbot Component
 *
 * Provides intelligent help assistance using AWS Bedrock Claude 3 Sonnet.
 * Key features:
 * - Floating chat interface accessible from all authenticated pages
 * - Minimize/maximize functionality for non-intrusive access
 * - Context-aware responses using uploaded help documentation
 * - Session-based chat history with persistence
 * - Real-time message streaming and response generation
 * - Integration with knowledge base for contextual assistance
 * - Auto-scroll to latest messages for optimal UX
 *
 * The chatbot analyzes user questions and provides relevant answers by:
 * - Searching through uploaded company policy documents
 * - Referencing knowledge base articles
 * - Providing step-by-step guidance for common issues
 * - Escalating complex queries to human support when needed
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MessageCircle,
  Send,
  Bot,
  User,
  X,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: number;
  userId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  relatedDocumentIds?: number[];
  createdAt: string;
}

interface ChatSession {
  sessionId: string;
  lastMessage: string;
  createdAt: string;
}

export function AiChatBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState("");
  const MAX_MESSAGE_LENGTH = 2000;
  const [sessionId, setSessionId] = useState(() => {
    const existing =
      typeof window !== "undefined"
        ? localStorage.getItem("aiChatSessionId")
        : null;
    if (existing) return existing;
    const id = `session-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    if (typeof window !== "undefined")
      localStorage.setItem("aiChatSessionId", id);
    return id;
  });
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch chat history
  const {
    data,
    refetch,
    error: fetchError,
  } = useQuery<ChatMessage[]>({
    queryKey: ["/api/chat", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/chat/${sessionId}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch chat history");
      return response.json();
    },
    enabled: isOpen && !!sessionId,
    retry: 1,
  });

  const messages: ChatMessage[] = Array.isArray(data)
    ? (data as ChatMessage[])
    : [];

  useEffect(() => {
    if (fetchError)
      setError((fetchError as any)?.message || "Failed to load chat history");
    else setError(null);
  }, [fetchError]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (messageText: string) => {
      const response = await apiRequest("POST", "/api/chat", {
        sessionId,
        message: messageText,
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat", sessionId] });
      setMessage("");
    },
    onError: (error: Error) => {
      console.error("Chat error:", error);
      setError(error.message || "Failed to send message");
    },
  });

  const startNewSession = () => {
    const id = `session-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    setSessionId(id);
    try {
      localStorage.setItem("aiChatSessionId", id);
    } catch {}
    queryClient.removeQueries({ queryKey: ["/api/chat", sessionId] });
    setError(null);
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (sendMessageMutation.isPending) return;
    if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) {
      setValidationError("Message must be 1–2000 characters");
      return;
    }
    setValidationError(null);
    sendMessageMutation.mutate(trimmed);
  };

  const toggleChat = () => {
    if (isMinimized) {
      setIsMinimized(false);
    } else {
      setIsOpen(!isOpen);
      if (!isOpen) {
        setIsMinimized(false);
      }
    }
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  {
    /* Chat Window */
  }
  return isOpen ? (
    <Card
      className={cn(
        "fixed bottom-6 right-6 w-96 shadow-2xl z-50 transition-all duration-200",
        isMinimized ? "h-14" : "h-[600px]"
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Help Assistant</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={startNewSession}
            variant="ghost"
            size="sm"
            className="h-8 px-2 mr-1"
            aria-label="Start new chat"
          >
            New chat
          </Button>
          <Button
            onClick={toggleMinimize}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
          >
            {isMinimized ? (
              <Maximize2 className="h-4 w-4" />
            ) : (
              <Minimize2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            onClick={() => setIsOpen(false)}
            variant="ghost"
            size="icon"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      {!isMinimized && (
        <CardContent className="p-0 flex flex-col h-[calc(100%-60px)]">
          {/* Messages Area */}
          <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
            {error && (
              <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 text-destructive px-3 py-2 text-sm flex items-center justify-between">
                <span>{error}</span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            )}
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-sm">Hi! I'm your help assistant.</p>
                <p className="text-sm">
                  Ask me anything about using TicketFlow.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex gap-3",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "flex gap-3 max-w-[80%]",
                        msg.role === "user" ? "flex-row-reverse" : "flex-row"
                      )}
                    >
                      <div
                        className={cn(
                          "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        )}
                      >
                        {msg.role === "user" ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Bot className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <div
                          className={cn(
                            "rounded-lg px-4 py-2",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          )}
                        >
                          <p className="text-sm whitespace-pre-wrap">
                            {msg.content}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(msg.createdAt), "HH:mm")}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {sendMessageMutation.isPending && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                      <Bot className="h-4 w-4" />
                    </div>
                    <div className="bg-muted rounded-lg px-4 py-2">
                      <p className="text-sm">Thinking...</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Input Area */}
          <form onSubmit={handleSendMessage} className="p-4 border-t">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={message}
                  onChange={(e) => {
                    const val = e.target.value.slice(0, MAX_MESSAGE_LENGTH);
                    setMessage(val);
                    const len = val.trim().length;
                    if (len === 0) setValidationError(null);
                    // only show on submit to be less noisy
                    else if (len > 0 && len <= MAX_MESSAGE_LENGTH)
                      setValidationError(null);
                  }}
                  placeholder="Type your question..."
                  disabled={sendMessageMutation.isPending}
                  className="flex-1"
                  maxLength={MAX_MESSAGE_LENGTH}
                  aria-invalid={!!validationError}
                />
                <div className="mt-1 flex items-center justify-between">
                  <p className="text-xs text-destructive min-h-4">
                    {validationError}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {message.trim().length}/{MAX_MESSAGE_LENGTH}
                  </p>
                </div>
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={
                  sendMessageMutation.isPending ||
                  message.trim().length === 0 ||
                  message.trim().length > MAX_MESSAGE_LENGTH
                }
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  ) : (
    <Button
      onClick={toggleChat}
      className="fixed bottom-6 right-6 rounded-full h-14 w-14 shadow-lg z-50"
      size="icon"
    >
      <MessageCircle className="h-6 w-6" />
    </Button>
  );
}
