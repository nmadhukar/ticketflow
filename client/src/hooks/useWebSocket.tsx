import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: string;
}

export function useWebSocket() {
  const { isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const connect = useCallback(() => {
    if (!isAuthenticated || socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      console.log("Connecting to WebSocket:", wsUrl);
      const socket = new WebSocket(wsUrl);
      
      socket.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        setReconnectAttempts(0);
        
        // Send authentication message
        if (user?.id) {
          socket.send(JSON.stringify({
            type: 'auth',
            userId: user.id
          }));
        }
      };

      socket.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      socket.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        socketRef.current = null;
        
        // Attempt to reconnect with exponential backoff
        if (isAuthenticated && reconnectAttempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          console.log(`Reconnecting in ${delay}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        }
      };

      socketRef.current = socket;
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
    }
  }, [isAuthenticated, reconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    setIsConnected(false);
    setReconnectAttempts(0);
  }, []);

  const sendMessage = useCallback((type: string, data: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, data, timestamp: new Date().toISOString() }));
    } else {
      console.warn("WebSocket is not connected");
    }
  }, []);

  const handleMessage = (message: WebSocketMessage) => {
    console.log("WebSocket message received:", message);
    
    switch (message.type) {
      case "ticket:created":
        // Invalidate ticket queries to refresh the list
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
        
        // Show notification for new ticket
        if (message.data.assignedTo === "current-user-id") { // Replace with actual user ID check
          toast({
            title: "New ticket assigned",
            description: `Ticket #${message.data.ticketNumber} has been assigned to you`,
          });
        }
        break;
        
      case "ticket:updated":
        // Invalidate specific ticket and list queries
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${message.data.id}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        
        // Show notification for important updates
        if (message.data.changes?.status === "resolved") {
          toast({
            title: "Ticket resolved",
            description: `Ticket #${message.data.ticketNumber} has been resolved`,
          });
        }
        break;
        
      case "ticket:comment":
        // Invalidate comment queries
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${message.data.ticketId}/comments`] });
        queryClient.invalidateQueries({ queryKey: ["/api/activity"] });
        
        // Show notification for new comments on assigned tickets
        if (message.data.isReply) {
          toast({
            title: "New comment",
            description: `New comment on ticket #${message.data.ticketNumber}`,
          });
        }
        break;
        
      case "knowledge:created":
        // Invalidate knowledge base queries
        queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
        
        // Show notification for AI-created articles
        if (message.data.sourceTicketId) {
          toast({
            title: "Knowledge article created",
            description: "AI has created a new knowledge article from a resolved ticket",
          });
        }
        break;
        
      case "ai:response":
        // Update specific ticket with AI response
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${message.data.ticketId}/auto-response`] });
        
        // Show notification for high-confidence AI responses
        if (message.data.confidence > 0.8) {
          toast({
            title: "AI response generated",
            description: `High-confidence response for ticket #${message.data.ticketNumber}`,
          });
        }
        break;
        
      case "team:update":
        // Invalidate team queries
        queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
        queryClient.invalidateQueries({ queryKey: ["/api/teams/my"] });
        break;
        
      case "user:update":
        // Invalidate user queries
        queryClient.invalidateQueries({ queryKey: ["/api/users"] });
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        break;
        
      case "system:notification":
        // Show system notifications
        toast({
          title: message.data.title || "System notification",
          description: message.data.message,
          variant: message.data.variant || "default",
        });
        break;
        
      default:
        console.log("Unknown WebSocket message type:", message.type);
    }
  };

  // Connect when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      connect();
    } else {
      disconnect();
    }
    
    return () => {
      disconnect();
    };
  }, [isAuthenticated, connect, disconnect]);

  // Subscribe to specific events
  const subscribe = useCallback((ticketId: number) => {
    sendMessage("subscribe", { ticketId });
  }, [sendMessage]);

  const unsubscribe = useCallback((ticketId: number) => {
    sendMessage("unsubscribe", { ticketId });
  }, [sendMessage]);

  return {
    isConnected,
    sendMessage,
    subscribe,
    unsubscribe,
  };
}

// WebSocket provider for global access
import { createContext, ReactNode, useContext } from "react";

interface WebSocketContextType {
  isConnected: boolean;
  sendMessage: (type: string, data: any) => void;
  subscribe: (ticketId: number) => void;
  unsubscribe: (ticketId: number) => void;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const webSocket = useWebSocket();
  
  return (
    <WebSocketContext.Provider value={webSocket}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocketContext must be used within WebSocketProvider");
  }
  return context;
}