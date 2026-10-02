import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FaqCacheManager } from "@/components/faq-cache-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Copy, Key, Trash2 } from "lucide-react";

interface KeyOwner {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean | null;
  isApproved?: boolean | null;
}

const ownerLabel = (u: KeyOwner) =>
  `${[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email} (${u.email})`;

const DeveloperResources = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // API Keys state. The plaintext key lives only in this state: it is never
  // stored in the browser and is gone once dismissed or the page is left.
  const [newApiKeyName, setNewApiKeyName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [showApiKey, setShowApiKey] = useState<string | null>(null);

  const { data: apiKeys } = useQuery({
    queryKey: ["/api/api-keys"],
    refetchOnMount: "always",
  });

  const { data: allUsers } = useQuery<KeyOwner[]>({
    queryKey: ["/api/admin/users"],
  });
  const owners = (allUsers ?? []).filter(
    (u) =>
      u.isActive &&
      u.isApproved &&
      u.id !== "system" &&
      u.id !== "ai-assistant"
  );
  const ownerById = new Map((allUsers ?? []).map((u) => [u.id, u]));

  // API Key mutations
  const createApiKeyMutation = useMutation({
    mutationFn: async (input: { userId: string; name: string }) => {
      const res = await apiRequest("POST", "/api/api-keys", input);
      return (await res.json()) as { plainKey: string };
    },
    onSuccess: (data) => {
      setShowApiKey(data.plainKey);
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setNewApiKeyName("");
      toast({
        title: "Success",
        description: "API key created successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create API key",
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
    if (!ownerId) {
      toast({
        title: "Error",
        description: "Choose the user this key is for",
        variant: "destructive",
      });
      return;
    }
    createApiKeyMutation.mutate({ userId: ownerId, name: newApiKeyName.trim() });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Success", description: "Copied to clipboard" });
    } catch {
      toast({
        title: "Could not copy",
        description: "Select the key and copy it by hand.",
        variant: "destructive",
      });
    }
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
          <p className="text-xs text-muted-foreground">
            A key acts as the user you choose, with ticket access only, and
            expires after 90 days. Only an admin can create or revoke keys.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="User the key is for"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            >
              <option value="">Choose a user...</option>
              {owners.map((u) => (
                <option key={u.id} value={u.id}>
                  {ownerLabel(u)}
                </option>
              ))}
            </select>
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
              <code className="flex-1 p-2 bg-white border rounded text-sm font-mono break-all">
                {showApiKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                aria-label="Copy API key"
                onClick={() => copyToClipboard(showApiKey)}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowApiKey(null)}
              >
                Done
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
                    <p className="font-medium">
                      {apiKey.name}
                      {apiKey.expired && (
                        <span className="ml-2 rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                          Expired
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      For:{" "}
                      {ownerById.get(apiKey.userId)
                        ? ownerLabel(ownerById.get(apiKey.userId)!)
                        : apiKey.userId}
                    </p>
                    <div className="flex items-center gap-4 mt-1">
                      <p className="text-xs text-muted-foreground">
                        Created:{" "}
                        {new Date(apiKey.createdAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last used:{" "}
                        {apiKey.lastUsedAt
                          ? new Date(apiKey.lastUsedAt).toLocaleDateString()
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
                      {apiKey.keyPrefix}...
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke ${apiKey.name}`}
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
