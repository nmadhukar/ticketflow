import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, Eye, FileText, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

export default function HelpDocs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadData, setUploadData] = useState({
    title: "",
    category: "",
    tags: "",
    file: null as File | null,
    content: "",
    fileData: "",
  });

  const [editingDocument, setEditingDocument] = useState<any>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch help documents
  const { data: documents, isLoading } = useQuery({
    queryKey: ["/api/admin/help"],
    retry: false,
    refetchOnMount: "always",
  });

  // Upload document mutation
  const uploadMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/admin/help", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/help"] });
      setIsUploadDialogOpen(false);
      setUploadData({
        title: "",
        category: "",
        tags: "",
        file: null,
        content: "",
        fileData: "",
      });
      toast({
        title: "Success",
        description: "Help document uploaded successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to upload help document",
        variant: "destructive",
      });
    },
  });

  // Update document mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return await apiRequest("PUT", `/api/admin/help/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/help"] });
      setIsEditDialogOpen(false);
      setEditingDocument(null);
      toast({
        title: "Success",
        description: "Help document updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update help document",
        variant: "destructive",
      });
    },
  });

  // Delete document mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/help/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/help"] });
      toast({
        title: "Success",
        description: "Help document deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete help document",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".docx") && !file.name.endsWith(".doc")) {
      toast({
        title: "Error",
        description: "Please upload a Word document (.doc or .docx)",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result?.toString().split(",")[1] || "";
      setUploadData({
        ...uploadData,
        file,
        fileData: base64String,
      });

      // Extract text content from Word doc (simplified - in production you'd use a proper library)
      // For now, we'll ask the admin to provide a summary
      toast({
        title: "File loaded",
        description: "Please provide a summary of the document content",
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = () => {
    if (!uploadData.title || !uploadData.file || !uploadData.content) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    uploadMutation.mutate({
      title: uploadData.title,
      filename: uploadData.file.name,
      content: uploadData.content,
      fileData: uploadData.fileData,
      category: uploadData.category || "General",
      tags: uploadData.tags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t),
    });
  };

  const handleEdit = (document: any) => {
    setEditingDocument({
      ...document,
      tags: document.tags?.join(", ") || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdate = () => {
    if (!editingDocument) return;

    updateMutation.mutate({
      id: editingDocument.id,
      data: {
        title: editingDocument.title,
        category: editingDocument.category,
        tags: editingDocument.tags
          .split(",")
          .map((t: string) => t.trim())
          .filter((t: string) => t),
        content: editingDocument.content,
      },
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this help document?")) {
      deleteMutation.mutate(id);
    }
  };

  const filteredDocuments = (documents as any)?.filter(
    (doc: any) =>
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.tags?.some((tag: string) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  return (
    <div className="space-y-6">
      {/* Header with Upload button */}
      <div className="flex justify-between items-center">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          onClick={() => setIsUploadDialogOpen(true)}
          className="flex items-center gap-2"
        >
          <Upload className="h-4 w-4" />
          Upload Document
        </Button>
      </div>

      {/* Documents Table */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Views</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filteredDocuments?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  No help documents found
                </TableCell>
              </TableRow>
            ) : (
              filteredDocuments?.map((doc: any) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {doc.title}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {doc.category || "General"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {doc.tags?.map((tag: string, index: number) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="text-xs"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {doc.viewCount || 0}
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(doc)}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(doc.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Upload Dialog */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Help Document</DialogTitle>
            <DialogDescription>
              Upload a Word document that users can reference before creating
              tickets
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Document Title</Label>
              <Input
                placeholder="e.g., How to Reset Your Password"
                value={uploadData.title}
                onChange={(e) =>
                  setUploadData({ ...uploadData, title: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={uploadData.category}
                onValueChange={(value) =>
                  setUploadData({ ...uploadData, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="General">General</SelectItem>
                  <SelectItem value="Account">Account</SelectItem>
                  <SelectItem value="Technical">Technical</SelectItem>
                  <SelectItem value="Billing">Billing</SelectItem>
                  <SelectItem value="Features">Features</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                placeholder="e.g., password, security, account"
                value={uploadData.tags}
                onChange={(e) =>
                  setUploadData({ ...uploadData, tags: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Word Document</Label>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2"
                >
                  <FileText className="h-4 w-4" />
                  Choose File
                </Button>
                {uploadData.file && (
                  <span className="text-sm text-muted-foreground">
                    {uploadData.file.name}
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".doc,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <div className="space-y-2">
              <Label>Content Summary</Label>
              <Textarea
                placeholder="Provide a searchable summary of the document content..."
                rows={4}
                value={uploadData.content}
                onChange={(e) =>
                  setUploadData({ ...uploadData, content: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                This summary will be searchable and help users find relevant
                documents
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsUploadDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploadMutation.isPending}>
              Upload Document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Help Document</DialogTitle>
            <DialogDescription>
              Update the document information
            </DialogDescription>
          </DialogHeader>
          {editingDocument && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Document Title</Label>
                <Input
                  value={editingDocument.title}
                  onChange={(e) =>
                    setEditingDocument({
                      ...editingDocument,
                      title: e.target.value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={editingDocument.category}
                  onValueChange={(value) =>
                    setEditingDocument({ ...editingDocument, category: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="General">General</SelectItem>
                    <SelectItem value="Account">Account</SelectItem>
                    <SelectItem value="Technical">Technical</SelectItem>
                    <SelectItem value="Billing">Billing</SelectItem>
                    <SelectItem value="Features">Features</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Tags (comma-separated)</Label>
                <Input
                  value={editingDocument.tags}
                  onChange={(e) =>
                    setEditingDocument({
                      ...editingDocument,
                      tags: e.target.value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Content Summary</Label>
                <Textarea
                  rows={4}
                  value={editingDocument.content}
                  onChange={(e) =>
                    setEditingDocument({
                      ...editingDocument,
                      content: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
