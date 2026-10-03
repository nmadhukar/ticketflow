import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FileUp,
  FileText,
  Trash2,
  Download,
  Calendar,
  User,
  HardDrive,
} from "lucide-react";
import { format } from "date-fns";

interface PolicyDocument {
  id: number;
  filename: string;
  description: string;
  fileSize: number;
  uploadedAt: Date;
  uploadedBy: string;
  uploadedByName?: string;
}

export default function Policies() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  // Fetch policy documents
  const { data: policies, isLoading } = useQuery({
    queryKey: ["/api/admin/company-policies"],
  });

  // Upload policy mutation
  const uploadPolicyMutation = useMutation({
    mutationFn: async ({
      file,
      description,
    }: {
      file: File;
      description: string;
    }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("description", description);

      const response = await fetch("/api/admin/company-policies", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/company-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faq-cache"] }); // Clear FAQ cache when policies change
      toast({
        title: "Success",
        description: "Policy document uploaded successfully",
      });
      setSelectedFile(null);
      setDescription("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to upload policy document",
        variant: "destructive",
      });
    },
  });

  // Delete policy mutation
  const deletePolicyMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/company-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/company-policies"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/faq-cache"] }); // Clear FAQ cache when policies change
      toast({
        title: "Success",
        description: "Policy document deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete policy document",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        // 10MB limit
        toast({
          title: "Error",
          description: "File size must be less than 10MB",
          variant: "destructive",
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !description.trim()) {
      toast({
        title: "Error",
        description: "Please select a file and provide a description",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    await uploadPolicyMutation.mutateAsync({ file: selectedFile, description });
    setUploading(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (policy: PolicyDocument) => {
    try {
      const response = await fetch(
        `/api/admin/company-policies/${policy.id}/download`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) throw new Error("Download failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = policy.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to download document",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>Upload New Policy Document</CardTitle>
          <CardDescription>
            Upload Word documents (.docx) containing company policies. These
            will be used by the AI assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="policy-file">Policy Document</Label>
            <div className="flex items-center gap-2">
              <Input
                id="policy-file"
                type="file"
                accept=".docx,.doc,.pdf"
                onChange={handleFileSelect}
                className="cursor-pointer"
              />
              {selectedFile && (
                <Badge variant="outline" className="whitespace-nowrap">
                  {selectedFile.name}
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="policy-description">Description</Label>
            <Input
              id="policy-description"
              placeholder="e.g., Employee Handbook, IT Security Policy, Leave Policy"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || !description.trim() || uploading}
            className="w-full"
          >
            <FileUp className="mr-2 h-4 w-4" />
            {uploading ? "Uploading..." : "Upload Policy Document"}
          </Button>
        </CardContent>
      </Card>

      {/* Policy List */}
      <Card>
        <CardHeader>
          <CardTitle>Policy Documents</CardTitle>
          <CardDescription>
            Manage uploaded company policy documents
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading policies...
            </div>
          ) : !policies || (policies as any).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No policy documents uploaded yet
            </div>
          ) : (
            <div className="space-y-3">
              {(policies as any).map((policy: PolicyDocument) => (
                <div
                  key={policy.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium">{policy.filename}</p>
                      <p className="text-sm text-muted-foreground">
                        {policy.description}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(policy.uploadedAt), "MMM d, yyyy")}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {policy.uploadedByName || policy.uploadedBy}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {formatFileSize(policy.fileSize)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownload(policy)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deletePolicyMutation.mutate(policy.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
