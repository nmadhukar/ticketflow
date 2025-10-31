import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import Header from "@/components/header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus,
  Edit,
  Trash2,
  BookOpen,
  Search,
  Eye,
  EyeOff,
  Brain,
  FileText,
  HelpCircle,
  Lightbulb,
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import type { KnowledgeArticle } from "@shared/schema";
import MainWrapper from "@/components/main-wrapper";

/**
 * Knowledge Base Management Page
 *
 * This component provides comprehensive knowledge base management functionality including:
 * - Manual creation of knowledge articles for common issues and resolutions
 * - Integration with AI-powered learning from resolved tickets
 * - Article management with publishing, editing, and deletion capabilities
 * - Search and filtering by category, status, and content
 * - Performance analytics for article effectiveness
 *
 * The page is designed for admin users to manage both manually created articles
 * and AI-generated knowledge from the learning system.
 */
export default function KnowledgeBase() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const queryClient = useQueryClient();

  const [isArticleDialogOpen, setIsArticleDialogOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] =
    useState<KnowledgeArticle | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Form states for article creation/editing
  const [articleTitle, setArticleTitle] = useState("");
  const [articleSummary, setArticleSummary] = useState("");
  const [articleContent, setArticleContent] = useState("");
  const [articleCategory, setArticleCategory] = useState("");
  const [articleTags, setArticleTags] = useState("");
  const [isPublished, setIsPublished] = useState(false);

  // Predefined categories for common issue types
  const knowledgeCategories = [
    "troubleshooting",
    "how-to",
    "faq",
    "technical",
    "user-guide",
    "system-admin",
    "security",
    "integration",
    "performance",
    "general",
  ];

  // Redirect to home if not authenticated or not admin
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "Admin access required. Redirecting...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, user, toast]);

  // Fetch knowledge articles
  const {
    data: articles = [],
    isLoading: articlesLoading,
    refetch: refetchArticles,
  } = useQuery<KnowledgeArticle[]>({
    queryKey: [
      "/api/admin/knowledge",
      {
        category: categoryFilter,
        status: statusFilter !== "all" ? statusFilter : undefined,
        source: sourceFilter !== "all" ? sourceFilter : undefined,
      },
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (categoryFilter && categoryFilter !== "all")
        params.append("category", categoryFilter);
      if (statusFilter && statusFilter !== "all")
        params.append("status", statusFilter);
      if (sourceFilter && sourceFilter !== "all")
        params.append("source", sourceFilter);

      const response = await fetch(
        `/api/admin/knowledge?${params.toString()}`,
        {
          credentials: "include",
        }
      );
      if (!response.ok) throw new Error("Failed to fetch knowledge articles");
      return response.json();
    },
    retry: false,
    enabled: isAuthenticated && (user as any)?.role === "admin",
  });

  // Create/Update article mutation
  const saveArticleMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = selectedArticle
        ? `/api/admin/knowledge/${selectedArticle.id}`
        : "/api/admin/knowledge";

      return await apiRequest(selectedArticle ? "PUT" : "POST", url, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/knowledge"] });
      resetArticleForm();
      setIsArticleDialogOpen(false);
      toast({
        title: "Success",
        description: `Knowledge article ${
          selectedArticle ? "updated" : "created"
        } successfully`,
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete article mutation
  const deleteArticleMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/knowledge/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/knowledge"] });
      toast({
        title: "Success",
        description: "Knowledge article deleted successfully",
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Toggle publish status mutation
  const togglePublishMutation = useMutation({
    mutationFn: async (article: KnowledgeArticle) => {
      return await apiRequest("PUT", `/api/admin/knowledge/${article.id}`, {
        isPublished: !article.isPublished,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/knowledge"] });
      toast({
        title: "Success",
        description: "Article status updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Trigger AI learning mutation
  const triggerLearningMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/ai/knowledge-learning/run", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to trigger knowledge learning");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/knowledge"] });
      toast({
        title: "AI Learning Complete",
        description: `Found ${data.patternsFound} patterns, created ${data.articlesCreated} articles (${data.articlesPublished} published)`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetArticleForm = () => {
    setArticleTitle("");
    setArticleSummary("");
    setArticleContent("");
    setArticleCategory("");
    setArticleTags("");
    setIsPublished(false);
    setSelectedArticle(null);
  };

  const handleEditArticle = (article: KnowledgeArticle) => {
    setSelectedArticle(article);
    setArticleTitle(article.title);
    setArticleSummary(article.summary || "");
    setArticleContent(article.content);
    setArticleCategory(article.category || "");
    setArticleTags(article.tags?.join(", ") || "");
    setIsPublished(article.isPublished || false);
    setIsArticleDialogOpen(true);
  };

  const handleSaveArticle = () => {
    if (!articleTitle.trim() || !articleContent.trim()) {
      toast({
        title: "Validation Error",
        description: "Title and content are required",
        variant: "destructive",
      });
      return;
    }

    const data = {
      title: articleTitle.trim(),
      summary: articleSummary.trim(),
      content: articleContent.trim(),
      category: articleCategory || "general",
      tags: articleTags
        ? articleTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [],
      isPublished,
    };

    saveArticleMutation.mutate(data);
  };

  // Filter articles based on search and filters
  const filteredArticles = articles.filter((article: KnowledgeArticle) => {
    const matchesSearch =
      !searchQuery ||
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.summary?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      !categoryFilter ||
      categoryFilter === "all" ||
      article.category === categoryFilter;
    const matchesStatus =
      !statusFilter ||
      statusFilter === "all" ||
      (article as any).status === statusFilter ||
      (statusFilter === "published" && article.isPublished);
    const matchesSource =
      !sourceFilter ||
      sourceFilter === "all" ||
      (article as any).source === sourceFilter;
    return matchesSearch && matchesCategory && matchesStatus && matchesSource;
  });

  const getStatusBadge = (article: KnowledgeArticle) => {
    if (article.isPublished) {
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          <CheckCircle className="h-3 w-3 mr-1" />
          Published
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <Clock className="h-3 w-3 mr-1" />
        Draft
      </Badge>
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "troubleshooting":
        return <AlertCircle className="h-4 w-4" />;
      case "how-to":
        return <BookOpen className="h-4 w-4" />;
      case "faq":
        return <HelpCircle className="h-4 w-4" />;
      case "technical":
        return <Brain className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  return (
    <MainWrapper
      title="Knowledge Base Management"
      subTitle="Manage knowledge articles for common issues and resolutions"
      action={
        (user as any)?.role === "admin" && (
          <div className="flex items-center gap-3">
            <Button
              onClick={() => triggerLearningMutation.mutate()}
              disabled={triggerLearningMutation.isPending}
              variant="outline"
            >
              {triggerLearningMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Brain className="h-4 w-4 mr-2" />
              )}
              AI Learning
            </Button>
            <Button onClick={() => resetArticleForm()}>
              <Plus className="h-4 w-4 mr-2" />
              Add Article
            </Button>
          </div>
        )
      }
    >
      {/* Filters and Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Filter & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="search">Search</Label>
              <Input
                id="search"
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="category-filter">Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {knowledgeCategories.map((category) => (
                    <SelectItem key={category} value={category}>
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(category)}
                        {category.charAt(0).toUpperCase() +
                          category.slice(1).replace("-", " ")}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status-filter">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="source-filter">Source</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="ai_generated">AI generated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Articles Table */}
      <Card>
        <CardHeader>
          <CardTitle>Knowledge Articles ({filteredArticles.length})</CardTitle>
          <CardDescription>
            Manage manually created and AI-generated knowledge articles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Views</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Effectiveness</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articlesLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    Loading articles...
                  </TableCell>
                </TableRow>
              ) : filteredArticles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    {searchQuery || categoryFilter || statusFilter
                      ? "No articles match your search criteria."
                      : "No knowledge articles found. Create your first article!"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredArticles.map((article: KnowledgeArticle) => (
                  <TableRow key={article.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(article.category || "general")}
                        <div>
                          <div className="font-medium">{article.title}</div>
                          {article.summary && (
                            <div className="text-sm text-muted-foreground">
                              {article.summary}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {article.category || "general"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          (article as any).source === "ai_generated"
                            ? "destructive"
                            : "default"
                        }
                      >
                        {(article as any).source === "ai_generated"
                          ? "AI"
                          : "Manual"}
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(article)}</TableCell>
                    <TableCell>{(article as any).viewCount || 0}</TableCell>
                    <TableCell>{article.usageCount || 0}</TableCell>
                    <TableCell>
                      {article.effectivenessScore
                        ? `${Math.round(
                            parseFloat(article.effectivenessScore) * 100
                          )}%`
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      {article.createdAt
                        ? format(new Date(article.createdAt), "MMM d, yyyy")
                        : "Unknown"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => togglePublishMutation.mutate(article)}
                          disabled={togglePublishMutation.isPending}
                        >
                          {article.isPublished ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEditArticle(article)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete Knowledge Article
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete "{article.title}
                                "? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  deleteArticleMutation.mutate(article.id)
                                }
                                disabled={deleteArticleMutation.isPending}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {deleteArticleMutation.isPending && (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                )}
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isArticleDialogOpen} onOpenChange={setIsArticleDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedArticle
                ? "Edit Knowledge Article"
                : "Create Knowledge Article"}
            </DialogTitle>
            <DialogDescription>
              {selectedArticle
                ? "Update the knowledge article details below."
                : "Create a new knowledge article for common issues and their resolutions."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                placeholder="e.g., How to reset password"
              />
            </div>
            <div>
              <Label htmlFor="summary">Summary</Label>
              <Input
                id="summary"
                value={articleSummary}
                onChange={(e) => setArticleSummary(e.target.value)}
                placeholder="Brief description of the solution"
              />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select
                value={articleCategory}
                onValueChange={setArticleCategory}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {knowledgeCategories.map((category) => (
                    <SelectItem key={category} value={category}>
                      <div className="flex items-center gap-2">
                        {getCategoryIcon(category)}
                        {category.charAt(0).toUpperCase() +
                          category.slice(1).replace("-", " ")}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={articleTags}
                onChange={(e) => setArticleTags(e.target.value)}
                placeholder="Comma-separated tags (e.g., password, authentication, login)"
              />
            </div>
            <div>
              <Label htmlFor="content">Content *</Label>
              <Textarea
                id="content"
                value={articleContent}
                onChange={(e) => setArticleContent(e.target.value)}
                placeholder="Detailed step-by-step resolution..."
                className="min-h-[200px]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="published"
                checked={isPublished}
                onCheckedChange={setIsPublished}
              />
              <Label htmlFor="published">Publish immediately</Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsArticleDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveArticle}
              disabled={saveArticleMutation.isPending}
            >
              {saveArticleMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {selectedArticle ? "Update" : "Create"} Article
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
