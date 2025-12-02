import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FaqCacheManager } from "@/components/faq-cache-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Copy, Eye, EyeOff, Key, Trash2 } from "lucide-react";

const DeveloperResources = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // API Keys state
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [showApiKey, setShowApiKey] = useState<string | null>(null);
  const [apiKeyVisibility, setApiKeyVisibility] = useState<
    Record<number, boolean>
  >({});

  const { data: apiKeys } = useQuery({
    queryKey: ["/api/api-keys"],
    refetchOnMount: "always",
  });

  // API Key mutations
  const createApiKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return await apiRequest("POST", "/api/api-keys", { name });
    },
    onSuccess: (data: any) => {
      setShowApiKey(data.plainKey);
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setNewApiKeyName("");
      toast({
        title: "Success",
        description: "API key created successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create API key",
        variant: "destructive",
      });
    },
  });

  const deleteApiKeyMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/api-keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      toast({
        title: "Success",
        description: "API key revoked successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to revoke API key",
        variant: "destructive",
      });
    },
  });

  const handleCreateApiKey = () => {
    if (!newApiKeyName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a name for the API key",
        variant: "destructive",
      });
      return;
    }
    createApiKeyMutation.mutate(newApiKeyName);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Success",
      description: "Copied to clipboard",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-medium text-muted-foreground">
          Manage API keys for third-party integrations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Create New API Key */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">Create New API Key</h4>
          <div className="flex gap-2">
            <Input
              placeholder="API Key Name (e.g., Mobile App, CI/CD Pipeline)"
              value={newApiKeyName}
              onChange={(e) => setNewApiKeyName(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleCreateApiKey()}
            />
            <Button
              onClick={handleCreateApiKey}
              disabled={createApiKeyMutation.isPending}
            >
              {createApiKeyMutation.isPending ? "Creating..." : "Create Key"}
            </Button>
          </div>
        </div>

        {/* Show newly created API key */}
        {showApiKey && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <h4 className="text-sm font-medium text-green-900 mb-2">
              API Key Created Successfully
            </h4>
            <p className="text-xs text-green-700 mb-3">
              Copy this key now. For security reasons, it won't be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-2 bg-white border rounded text-sm font-mono">
                {showApiKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  copyToClipboard(showApiKey);
                  setShowApiKey(null);
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {/* Existing API Keys */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">Active API Keys</h4>
          {(apiKeys as any) && (apiKeys as any).length > 0 ? (
            <div className="space-y-2">
              {(apiKeys as any).map((apiKey: any) => (
                <div
                  key={apiKey.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <p className="font-medium">{apiKey.name}</p>
                    <div className="flex items-center gap-4 mt-1">
                      <p className="text-xs text-muted-foreground">
                        Created:{" "}
                        {new Date(apiKey.createdAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last used:{" "}
                        {apiKey.lastUsed
                          ? new Date(apiKey.lastUsed).toLocaleDateString()
                          : "Never"}
                      </p>
                      {apiKey.expiresAt && (
                        <p className="text-xs text-muted-foreground">
                          Expires:{" "}
                          {new Date(apiKey.expiresAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono bg-muted px-2 py-1 rounded">
                      {apiKey.key ? apiKey.key.substring(0, 8) + "..." : "N/A"}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const visibility = { ...apiKeyVisibility };
                        visibility[apiKey.id] = !visibility[apiKey.id];
                        setApiKeyVisibility(visibility);
                      }}
                    >
                      {apiKeyVisibility[apiKey.id] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteApiKeyMutation.mutate(apiKey.id)}
                      disabled={deleteApiKeyMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No API keys yet. Create one to get started!</p>
            </div>
          )}
        </div>

        <Separator />

        {/* API Documentation Link */}
        <div className="rounded-lg bg-muted p-4">
          <h4 className="text-sm font-medium mb-2">API Documentation</h4>
          <p className="text-sm text-muted-foreground mb-3">
            Learn how to integrate with TicketFlow using our REST API.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="/api-docs" target="_blank">
              View API Documentation
            </a>
          </Button>
        </div>

        <Separator />

        {/* FAQ Cache Management */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium">FAQ Cache Management</h4>
          <FaqCacheManager />
        </div>
      </CardContent>
    </Card>
  );
};

export default DeveloperResources;
