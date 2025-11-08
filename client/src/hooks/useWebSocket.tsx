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
  const reconnectAttemptsRef = useRef(0);
  const lastErrorAtRef = useRef<number>(0);

  const connect = useCallback(() => {
    const rs = socketRef.current?.readyState;
    if (
      !isAuthenticated ||
      rs === WebSocket.OPEN ||
      rs === WebSocket.CONNECTING
    ) {
      return;
    }

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

      // Construct host reliably - handle cases where window.location.host might be malformed
      let host = window.location.host;

      // Check if host contains 'undefined' (common issue with proxies/development)
      if (!host || host.includes("undefined")) {
        const hostname = window.location.hostname || "localhost";
        const port = window.location.port;

        // Only include port if it exists and is not a default port
        if (port && port !== "" && port !== "80" && port !== "443") {
          host = `${hostname}:${port}`;
        } else {
          host = hostname;
        }
      }

      const wsUrl = `${protocol}//${host}/ws`;

      console.log("Connecting to WebSocket:", wsUrl);
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log("WebSocket connected");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;

        // Send authentication message
        if ((user as any)?.id) {
          socket.send(
            JSON.stringify({
              type: "auth",
              userId: (user as any).id,
            })
          );
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
        const now = Date.now();
        if (now - lastErrorAtRef.current > 5000) {
          lastErrorAtRef.current = now;
          toast({
            title: "Realtime connection issue",
            description: "We’ll retry automatically in the background.",
            variant: "default",
          });
        }
      };

      socket.onclose = () => {
        console.log("WebSocket disconnected");
        setIsConnected(false);
        socketRef.current = null;

        // Attempt to reconnect with exponential backoff
        const attempts = reconnectAttemptsRef.current;
        if (isAuthenticated && attempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
          console.log(`Reconnecting in ${delay}ms...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current = attempts + 1;
            connect();
          }, delay);
        }
      };

      socketRef.current = socket;
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      const now = Date.now();
      if (now - lastErrorAtRef.current > 5000) {
        lastErrorAtRef.current = now;
        toast({
          title: "Realtime connection failed",
          description: "Retrying shortly…",
          variant: "default",
        });
      }
      // Trigger a backoff retry even when constructor throws
      const attempts = reconnectAttemptsRef.current;
      if (isAuthenticated && attempts < 5) {
        const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current = attempts + 1;
          connect();
        }, delay);
      }
    }
  }, [isAuthenticated]);

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
    reconnectAttemptsRef.current = 0;
  }, []);

  const sendMessage = useCallback((type: string, data: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({ type, data, timestamp: new Date().toISOString() })
      );
    } else {
      console.warn("WebSocket is not connected");
    }
  }, []);

  // Simple de-duplication window for identical messages
  const lastMsgRef = useRef<{ key: string; ts: number } | null>(null);

  const handleMessage = (message: WebSocketMessage) => {
    console.log("WebSocket message received:", message);
    try {
      const key = `${message.type}:${JSON.stringify(message.data || {})}`;
      const now = Date.now();
      if (
        lastMsgRef.current &&
        lastMsgRef.current.key === key &&
        now - lastMsgRef.current.ts < 1000
      ) {
        return; // drop duplicate within 1s window
      }
      lastMsgRef.current = { key, ts: now };
    } catch {}

    switch (message.type) {
      case "connected":
        // Initial handshake from server
        break;
      case "ticket:created":
        // Invalidate ticket queries to refresh the list
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/agent"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/manager"] });
        queryClient.invalidateQueries({ queryKey: ["/api/activity"] });

        // Show notification for new ticket
        if (
          (user as any)?.id &&
          (message as any).data?.assigneeId === (user as any).id
        ) {
          toast({
            title: "New ticket assigned",
            description: `Ticket #${message.data.ticketNumber} has been assigned to you`,
          });
        }
        break;

      case "ticket:updated":
        // Invalidate specific ticket and list queries
        queryClient.invalidateQueries({
          queryKey: [`/api/tasks/${message.data.id}`],
        });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/agent"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats/manager"] });

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
        queryClient.invalidateQueries({
          queryKey: [`/api/tasks/${message.data.ticketId}/comments`],
        });
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
            description:
              "AI has created a new knowledge article from a resolved ticket",
          });
        }
        break;

      case "ai:response":
        // Update specific ticket with AI response
        queryClient.invalidateQueries({
          queryKey: [`/api/tasks/${message.data.ticketId}/auto-response`],
        });

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
  const subscribe = useCallback(
    (ticketId: number) => {
      sendMessage("subscribe", { ticketId });
    },
    [sendMessage]
  );

  const unsubscribe = useCallback(
    (ticketId: number) => {
      sendMessage("unsubscribe", { ticketId });
    },
    [sendMessage]
  );

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
    throw new Error(
      "useWebSocketContext must be used within WebSocketProvider"
    );
  }
  return context;
}
