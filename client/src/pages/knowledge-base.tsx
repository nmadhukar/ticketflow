import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  FileText,
  Tag,
  Calendar,
  User,
  Brain,
  CheckCircle,
  XCircle,
  Book,
  Sparkles,
  BarChart,
  ThumbsUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

interface KnowledgeArticle {
  id: number;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  status: "draft" | "published" | "archived";
  viewCount: number;
  helpfulCount: number;
  sourceTicketId?: number;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  isPublished: boolean;
  effectivenessScore: number;
  usageCount: number;
  sourceTicketNumber?: string;
  resolutionFromTicketId?: number;
}

export default function KnowledgeBase() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("published");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [showAIGenerated, setShowAIGenerated] = useState(true);
  const [isSemanticSearch, setIsSemanticSearch] = useState(false);
  const [semanticSearchResults, setSemanticSearchResults] = useState<any[]>([]);
  
  // Form state
  const [formData, setFormData] = useState({
    title: "",
    summary: "",
    content: "",
    category: "general",
    tags: "",
    status: "draft" as "draft" | "published" | "archived",
  });

  // Fetch knowledge articles
  const { data: articles, isLoading } = useQuery({
    queryKey: ["/api/knowledge"],
  });

  // Search knowledge base
  const searchArticles = useMutation({
    mutationFn: async (query: string) => {
      const res = await apiRequest("POST", "/api/knowledge-base/search", { query, limit: 10 });
      return res.json();
    },
    onSuccess: (data) => {
      setSemanticSearchResults(data);
      setIsSemanticSearch(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Search failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create article mutation
  const createArticle = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/knowledge", {
        ...data,
        tags: data.tags.split(",").map(t => t.trim()).filter(Boolean),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({
        title: "Article created",
        description: "The knowledge article has been created successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Creation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update article mutation
  const updateArticle = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof formData }) => {
      const res = await apiRequest("PATCH", `/api/knowledge/${id}`, {
        ...data,
        tags: data.tags.split(",").map(t => t.trim()).filter(Boolean),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      setEditingArticle(null);
      resetForm();
      toast({
        title: "Article updated",
        description: "The knowledge article has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete article mutation
  const deleteArticle = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/knowledge/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      toast({
        title: "Article deleted",
        description: "The knowledge article has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Deletion failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Create from resolved ticket
  const createFromTicket = useMutation({
    mutationFn: async (ticketId: number) => {
      const res = await apiRequest("POST", `/api/knowledge/from-ticket/${ticketId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/knowledge"] });
      toast({
        title: "Article created from ticket",
        description: "A knowledge article has been created from the resolved ticket.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Creation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setFormData({
      title: "",
      summary: "",
      content: "",
      category: "general",
      tags: "",
      status: "draft",
    });
  };

  const handleEdit = (article: KnowledgeArticle) => {
    setEditingArticle(article);
    setFormData({
      title: article.title,
      summary: article.summary,
      content: article.content,
      category: article.category,
      tags: article.tags.join(", "),
      status: article.status,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingArticle) {
      await updateArticle.mutateAsync({ id: editingArticle.id, data: formData });
    } else {
      await createArticle.mutateAsync(formData);
    }
  };

  const handleSemanticSearch = async () => {
    if (!searchTerm.trim()) {
      setIsSemanticSearch(false);
      setSemanticSearchResults([]);
      return;
    }
    
    await searchArticles.mutateAsync(searchTerm);
  };

  // Filter articles
  const filteredArticles = articles || [];
  const displayArticles = isSemanticSearch 
    ? semanticSearchResults.map(result => result.article)
    : filteredArticles.filter((article: KnowledgeArticle) => {
        const matchesSearch = searchTerm === "" ||
          article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          article.summary.toLowerCase().includes(searchTerm.toLowerCase()) ||
          article.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
          article.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const matchesCategory = categoryFilter === "all" || article.category === categoryFilter;
        const matchesStatus = statusFilter === "all" || article.isPublished;
        const matchesAIFilter = !showAIGenerated || (showAIGenerated && article.resolutionFromTicketId);

        return matchesSearch && matchesCategory && matchesStatus;
      });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "published":
        return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
      case "draft":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400";
      case "archived":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "general":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
      case "technical":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400";
      case "troubleshooting":
        return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400";
      case "howto":
        return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
      case "faq":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Book className="h-8 w-8" />
              Knowledge Base
            </h1>
            <p className="text-muted-foreground">
              Manage and search knowledge articles created from resolved tickets
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Create Article
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>Create Knowledge Article</DialogTitle>
                  <DialogDescription>
                    Create a new knowledge article to help resolve future tickets faster.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="Enter article title"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summary">Summary</Label>
                    <Textarea
                      id="summary"
                      value={formData.summary}
                      onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                      placeholder="Brief summary of the article"
                      rows={2}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="content">Content</Label>
                    <Textarea
                      id="content"
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      placeholder="Detailed article content"
                      rows={6}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => setFormData({ ...formData, category: value })}
                      >
                        <SelectTrigger id="category">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="technical">Technical</SelectItem>
                          <SelectItem value="troubleshooting">Troubleshooting</SelectItem>
                          <SelectItem value="howto">How-To</SelectItem>
                          <SelectItem value="faq">FAQ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <Select
                        value={formData.status}
                        onValueChange={(value: "draft" | "published" | "archived") => 
                          setFormData({ ...formData, status: value })
                        }
                      >
                        <SelectTrigger id="status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft</SelectItem>
                          <SelectItem value="published">Published</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tags">Tags (comma-separated)</Label>
                    <Input
                      id="tags"
                      value={formData.tags}
                      onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                      placeholder="tag1, tag2, tag3"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createArticle.isPending}>
                    Create Article
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Search & Filter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search articles..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    if (!e.target.value.trim()) {
                      setIsSemanticSearch(false);
                      setSemanticSearchResults([]);
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSemanticSearch()}
                  className="pl-9"
                />
              </div>
              <Button 
                onClick={handleSemanticSearch}
                disabled={searchArticles.isPending || !searchTerm.trim()}
                variant={isSemanticSearch ? "default" : "outline"}
              >
                <Brain className="h-4 w-4 mr-2" />
                {searchArticles.isPending ? "Searching..." : "AI Search"}
              </Button>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="troubleshooting">Troubleshooting</SelectItem>
                  <SelectItem value="howto">How-To</SelectItem>
                  <SelectItem value="faq">FAQ</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* AI-Generated Filter and Search Info */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="ai-generated"
                    checked={showAIGenerated}
                    onCheckedChange={setShowAIGenerated}
                  />
                  <Label htmlFor="ai-generated" className="cursor-pointer">
                    Show AI-Generated Articles
                  </Label>
                </div>
              </div>
              
              {isSemanticSearch && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  Showing {semanticSearchResults.length} AI-powered search results
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Articles Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Knowledge Articles</CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {filteredArticles?.length || 0} articles
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Loading articles...</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead className="w-28">Category</TableHead>
                      <TableHead className="w-24">Status</TableHead>
                      <TableHead className="w-32">Stats</TableHead>
                      <TableHead className="w-32">Created</TableHead>
                      <TableHead className="w-28">Effectiveness</TableHead>
                      <TableHead className="w-24">Source</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayArticles?.map((article: KnowledgeArticle) => (
                      <TableRow key={article.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{article.title}</div>
                            <div className="text-sm text-muted-foreground line-clamp-2">
                              {article.summary}
                            </div>
                            {article.tags.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap">
                                {article.tags.map((tag, index) => (
                                  <Badge key={index} variant="outline" className="text-xs">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getCategoryColor(article.category)}>
                            {article.category}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={getStatusColor(article.status)}>
                            {article.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-1">
                              <BarChart className="h-3 w-3 text-muted-foreground" />
                              {article.usageCount || 0} uses
                            </div>
                            <div className="flex items-center gap-1">
                              <ThumbsUp className="h-3 w-3 text-muted-foreground" />
                              {article.helpfulCount} helpful
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3 text-muted-foreground" />
                              {article.createdByName || "System"}
                            </div>
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(article.createdAt), "MMM d")}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {article.resolutionFromTicketId ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1">
                                <Sparkles className="h-4 w-4 text-primary" />
                                <span className="text-xs font-medium">
                                  {(article.effectivenessScore * 100).toFixed(0)}%
                                </span>
                              </div>
                              <Progress 
                                value={article.effectivenessScore * 100} 
                                className="h-1 w-16"
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {article.sourceTicketNumber ? (
                            <div className="flex items-center gap-1">
                              <Brain className="h-4 w-4 text-primary" />
                              <span className="text-xs">{article.sourceTicketNumber}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Manual</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(article)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deleteArticle.mutate(article.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {displayArticles?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    {isSemanticSearch ? "No articles found matching your search query." : "No articles found matching your filters."}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Dialog */}
        <Dialog open={!!editingArticle} onOpenChange={(open) => !open && setEditingArticle(null)}>
          <DialogContent className="max-w-2xl">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Edit Knowledge Article</DialogTitle>
                <DialogDescription>
                  Update the knowledge article details.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-title">Title</Label>
                  <Input
                    id="edit-title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Enter article title"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-summary">Summary</Label>
                  <Textarea
                    id="edit-summary"
                    value={formData.summary}
                    onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                    placeholder="Brief summary of the article"
                    rows={2}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-content">Content</Label>
                  <Textarea
                    id="edit-content"
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    placeholder="Detailed article content"
                    rows={6}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-category">Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => setFormData({ ...formData, category: value })}
                    >
                      <SelectTrigger id="edit-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="technical">Technical</SelectItem>
                        <SelectItem value="troubleshooting">Troubleshooting</SelectItem>
                        <SelectItem value="howto">How-To</SelectItem>
                        <SelectItem value="faq">FAQ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-status">Status</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(value: "draft" | "published" | "archived") => 
                        setFormData({ ...formData, status: value })
                      }
                    >
                      <SelectTrigger id="edit-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="published">Published</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
                  <Input
                    id="edit-tags"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="tag1, tag2, tag3"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingArticle(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateArticle.isPending}>
                  Update Article
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}