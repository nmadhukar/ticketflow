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
  CardFooter,
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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["common", "knowledge"]);

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
        title: t("messages.unauthorized"),
        description: t("messages.loggedOut"),
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
        title: t("messages.success"),
        description: selectedArticle
          ? t("knowledge:toasts.updated")
          : t("knowledge:toasts.created"),
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: t("messages.unauthorized"),
          description: t("messages.loggedOut"),
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: t("messages.error"),
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
        title: t("messages.success"),
        description: t("knowledge:toasts.deleted"),
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: t("messages.unauthorized"),
          description: t("messages.loggedOut"),
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }
      toast({
        title: t("messages.error"),
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
        title: t("knowledge:toasts.aiComplete"),
        description: `Found ${data.patternsFound} patterns, created ${data.articlesCreated} articles (${data.articlesPublished} published)`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("messages.error"),
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
        title: t("messages.error"),
        description: t("validation.required", {
          defaultValue: "Title and content are required",
        }),
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
      title={t("knowledge:title")}
      subTitle={t("knowledge:subtitle")}
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
              {t("knowledge:actions.aiLearning")}
            </Button>
            <Button
              onClick={() => {
                resetArticleForm();
                setIsArticleDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t("knowledge:actions.addArticle")}
            </Button>
          </div>
        )
      }
    >
      <Card>
        <CardHeader>
          <div className="w-full flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>
                {t("knowledge:table.title", { count: filteredArticles.length })}
              </CardTitle>
              {(user as any)?.role === "admin" && (
                <CardDescription>{t("knowledge:table.manage")}</CardDescription>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setSearchQuery("");
                setCategoryFilter("all");
                setStatusFilter("all");
              }}
            >
              {t("knowledge:actions.clearFilters")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-7 p-5 gap-8">
              <div className="relative col-span-1 md:col-span-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder={t("knowledge:filters.searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("knowledge:filters.allCategories")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("knowledge:filters.allCategories")}
                  </SelectItem>
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

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("knowledge:filters.allStatuses")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("knowledge:filters.allStatuses")}
                  </SelectItem>
                  <SelectItem value="published">
                    {t("knowledge:filters.published")}
                  </SelectItem>
                  <SelectItem value="draft">
                    {t("knowledge:filters.draft")}
                  </SelectItem>
                  <SelectItem value="archived">
                    {t("knowledge:filters.archived")}
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("knowledge:filters.allSources")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("knowledge:filters.allSources")}
                  </SelectItem>
                  <SelectItem value="manual">
                    {t("knowledge:filters.manual")}
                  </SelectItem>
                  <SelectItem value="ai_generated">
                    {t("knowledge:filters.ai_generated")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Card>
        </CardContent>
        <CardFooter className="flex justify-end"></CardFooter>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("knowledge:table.columns.title")}</TableHead>
                <TableHead>{t("knowledge:table.columns.category")}</TableHead>
                <TableHead>{t("knowledge:table.columns.source")}</TableHead>
                <TableHead>{t("knowledge:table.columns.status")}</TableHead>
                <TableHead>{t("knowledge:table.columns.views")}</TableHead>
                <TableHead>{t("knowledge:table.columns.usage")}</TableHead>
                <TableHead>
                  {t("knowledge:table.columns.effectiveness")}
                </TableHead>
                <TableHead>{t("knowledge:table.columns.created")}</TableHead>
                <TableHead className="text-right">
                  {t("knowledge:table.columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articlesLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    {t("knowledge:table.loading")}
                  </TableCell>
                </TableRow>
              ) : filteredArticles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    {searchQuery || categoryFilter || statusFilter
                      ? t("knowledge:table.emptyFiltered")
                      : t("knowledge:table.empty")}
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
                          ? t("knowledge:badges.ai")
                          : t("knowledge:badges.manual")}
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
                                {t("knowledge:delete.title")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("knowledge:delete.confirm", {
                                  title: article.title,
                                })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t("common.actions.cancel")}
                              </AlertDialogCancel>
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
                                {t("knowledge:actions.delete")}
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
                ? t("knowledge:dialog.editTitle")
                : t("knowledge:dialog.createTitle")}
            </DialogTitle>
            <DialogDescription>
              {selectedArticle
                ? t("knowledge:dialog.editDesc")
                : t("knowledge:dialog.createDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">
                {t("knowledge:dialog.fields.title")}
              </Label>
              <Input
                id="title"
                value={articleTitle}
                onChange={(e) => setArticleTitle(e.target.value)}
                placeholder={t("knowledge:dialog.fields.titlePlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="summary">
                {t("knowledge:dialog.fields.summary")}
              </Label>
              <Input
                id="summary"
                value={articleSummary}
                onChange={(e) => setArticleSummary(e.target.value)}
                placeholder={t("knowledge:dialog.fields.summary")}
              />
            </div>
            <div>
              <Label htmlFor="category">
                {t("knowledge:dialog.fields.category")}
              </Label>
              <Select
                value={articleCategory}
                onValueChange={setArticleCategory}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "knowledge:dialog.fields.categoryPlaceholder"
                    )}
                  />
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
              <Label htmlFor="tags">{t("knowledge:dialog.fields.tags")}</Label>
              <Input
                id="tags"
                value={articleTags}
                onChange={(e) => setArticleTags(e.target.value)}
                placeholder={t("knowledge:dialog.fields.tagsPlaceholder")}
              />
            </div>
            <div>
              <Label htmlFor="content">
                {t("knowledge:dialog.fields.content")}
              </Label>
              <Textarea
                id="content"
                value={articleContent}
                onChange={(e) => setArticleContent(e.target.value)}
                placeholder={t("knowledge:dialog.fields.contentPlaceholder")}
                className="min-h-[200px]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="published"
                checked={isPublished}
                onCheckedChange={setIsPublished}
              />
              <Label htmlFor="published">
                {t("knowledge:actions.publishNow")}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsArticleDialogOpen(false)}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              onClick={handleSaveArticle}
              disabled={saveArticleMutation.isPending}
            >
              {saveArticleMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {selectedArticle
                ? t("knowledge:dialog.submitUpdate")
                : t("knowledge:dialog.submitCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainWrapper>
  );
}
