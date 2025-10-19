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
 * - Integration with AWS Bedrock Knowledge Bases for semantic search
 * - Citations to source documents for transparency
 * - Auto-scroll to latest messages for optimal UX
 * 
 * The chatbot analyzes user questions and provides relevant answers by:
 * - Using semantic vector search (when Knowledge Base is configured)
 * - Searching through uploaded company policy documents
 * - Referencing knowledge base articles
 * - Providing step-by-step guidance for common issues
 * - Showing citations to source documents
 * - Escalating complex queries to human support when needed
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Bot, User, X, Minimize2, Maximize2, FileText, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Citation {
  content: string;
  location?: any;
}

interface ChatMessage {
  id: number;
  userId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  relatedDocumentIds?: number[];
  citations?: Citation[];
  fromCache?: boolean;
  usageData?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
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
  const [sessionId, setSessionId] = useState(() => {
    // Generate a unique session ID for this chat session
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  });
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Fetch chat history
  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ['/api/chat', sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/chat/${sessionId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch chat history');
      return response.json();
    },
    enabled: isOpen && !!sessionId,
  });

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (messageText: string) => {
      const response = await apiRequest('POST', '/api/chat', {
        sessionId,
        message: messageText,
      });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chat', sessionId] });
      setMessage("");
    },
    onError: (error: Error) => {
      console.error("Chat error:", error);
    },
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !sendMessageMutation.isPending) {
      sendMessageMutation.mutate(message.trim());
    }
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

  return (
    <>
      {/* Chat Button */}
      {!isOpen && (
        <Button
          onClick={toggleChat}
          className="fixed bottom-6 right-6 rounded-full h-14 w-14 shadow-lg z-50"
          size="icon"
          data-testid="button-open-chat"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <Card className={cn(
          "fixed bottom-6 right-6 w-96 shadow-2xl z-50 transition-all duration-200",
          isMinimized ? "h-14" : "h-[600px]"
        )} data-testid="card-chat-window">
          <CardHeader className="flex flex-row items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Help Assistant</CardTitle>
            </div>
            <div className="flex items-center gap-1">
              <Button
                onClick={toggleMinimize}
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                data-testid="button-minimize-chat"
              >
                {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              </Button>
              <Button
                onClick={() => setIsOpen(false)}
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                data-testid="button-close-chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          {!isMinimized && (
            <CardContent className="p-0 flex flex-col h-[calc(100%-60px)]">
              {/* Messages Area */}
              <ScrollArea ref={scrollAreaRef} className="flex-1 p-4">
                {messages.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Bot className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-sm">Hi! I'm your help assistant.</p>
                    <p className="text-sm">Ask me anything about using TicketFlow.</p>
                    <div className="mt-4 text-xs space-y-1">
                      <div className="flex items-center justify-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        <span>Powered by AWS Bedrock Knowledge Base</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "flex gap-3",
                          msg.role === 'user' ? "justify-end" : "justify-start"
                        )}
                        data-testid={`message-${msg.role}-${msg.id}`}
                      >
                        <div className={cn(
                          "flex gap-3 max-w-[85%]",
                          msg.role === 'user' ? "flex-row-reverse" : "flex-row"
                        )}>
                          <div className={cn(
                            "h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0",
                            msg.role === 'user' ? "bg-primary text-primary-foreground" : "bg-muted"
                          )}>
                            {msg.role === 'user' ? (
                              <User className="h-4 w-4" />
                            ) : (
                              <Bot className="h-4 w-4" />
                            )}
                          </div>
                          <div className="flex-1">
                            <div className={cn(
                              "rounded-lg px-4 py-2",
                              msg.role === 'user' 
                                ? "bg-primary text-primary-foreground" 
                                : "bg-muted"
                            )}>
                              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                            </div>
                            
                            {/* Citations from Knowledge Base */}
                            {msg.role === 'assistant' && msg.citations && msg.citations.length > 0 && (
                              <div className="mt-2 space-y-1">
                                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  Sources:
                                </p>
                                {msg.citations.map((citation, idx) => (
                                  <div key={idx} className="text-xs bg-muted/50 rounded p-2 border border-border/50">
                                    <p className="line-clamp-2">{citation.content.substring(0, 150)}...</p>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Metadata Badges */}
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(msg.createdAt), 'HH:mm')}
                              </p>
                              {msg.role === 'assistant' && (
                                <>
                                  {msg.fromCache && (
                                    <Badge variant="secondary" className="text-xs h-4 px-1">
                                      Cached
                                    </Badge>
                                  )}
                                  {msg.citations && msg.citations.length > 0 && (
                                    <Badge variant="outline" className="text-xs h-4 px-1 flex items-center gap-1">
                                      <Sparkles className="h-2 w-2" />
                                      KB
                                    </Badge>
                                  )}
                                  {msg.usageData && (
                                    <span className="text-xs text-muted-foreground">
                                      {msg.usageData.totalTokens} tokens
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {sendMessageMutation.isPending && (
                      <div className="flex gap-3" data-testid="message-loading">
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                          <Bot className="h-4 w-4 animate-pulse" />
                        </div>
                        <div className="bg-muted rounded-lg px-4 py-2">
                          <p className="text-sm">Searching knowledge base...</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>

              {/* Input Area */}
              <form onSubmit={handleSendMessage} className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type your question..."
                    disabled={sendMessageMutation.isPending}
                    className="flex-1"
                    data-testid="input-chat-message"
                  />
                  <Button 
                    type="submit" 
                    size="icon"
                    disabled={!message.trim() || sendMessageMutation.isPending}
                    data-testid="button-send-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </form>
            </CardContent>
          )}
        </Card>
      )}
    </>
  );
}
