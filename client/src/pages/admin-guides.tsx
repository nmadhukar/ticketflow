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
  Plus,
  Edit,
  Trash2,
  BookOpen,
  Video,
  FileText,
  FolderPlus,
  Eye,
  EyeOff,
} from "lucide-react";
import { format } from "date-fns";
import type { UserGuide, UserGuideCategory } from "@shared/schema";
import MainWrapper from "@/components/main-wrapper";

export default function AdminGuides() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const queryClient = useQueryClient();

  const [isGuideDialogOpen, setIsGuideDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<UserGuide | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<UserGuideCategory | null>(null);

  // Form states for guide
  const [guideTitle, setGuideTitle] = useState("");
  const [guideDescription, setGuideDescription] = useState("");
  const [guideCategory, setGuideCategory] = useState("");
  const [guideType, setGuideType] = useState<"scribehow" | "html" | "video">(
    "html"
  );
  const [guideContent, setGuideContent] = useState("");
  const [scribehowUrl, setScribehowUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [guideTags, setGuideTags] = useState("");
  const [isPublished, setIsPublished] = useState(true);

  // Form states for category
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [categoryIcon, setCategoryIcon] = useState("");
  const [categoryOrder, setCategoryOrder] = useState(0);

  // Redirect to home if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
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
  }, [isAuthenticated, isLoading, toast]);

  // Fetch guides
  const { data: guides = [], isLoading: guidesLoading } = useQuery<UserGuide[]>(
    {
      queryKey: ["/api/guides"],
      retry: false,
      enabled: isAuthenticated,
    }
  );

  // Fetch categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery<
    UserGuideCategory[]
  >({
    queryKey: ["/api/guide-categories"],
    retry: false,
    enabled: isAuthenticated,
  });

  // Create/Update guide mutation
  const saveGuideMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = selectedGuide
        ? `/api/admin/guides/${selectedGuide.id}`
        : "/api/admin/guides";

      return await apiRequest(selectedGuide ? "PUT" : "POST", url, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guides"] });
      resetGuideForm();
      setIsGuideDialogOpen(false);
      toast({
        title: "Success",
        description: `Guide ${
          selectedGuide ? "updated" : "created"
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

  // Delete guide mutation
  const deleteGuideMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/guides/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guides"] });
      toast({
        title: "Success",
        description: "Guide deleted successfully",
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

  // Create/Update category mutation
  const saveCategoryMutation = useMutation({
    mutationFn: async (data: any) => {
      const url = selectedCategory
        ? `/api/admin/guide-categories/${selectedCategory.id}`
        : "/api/admin/guide-categories";

      return await apiRequest(selectedCategory ? "PUT" : "POST", url, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guide-categories"] });
      resetCategoryForm();
      setIsCategoryDialogOpen(false);
      toast({
        title: "Success",
        description: `Category ${
          selectedCategory ? "updated" : "created"
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

  // Delete category mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/admin/guide-categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guide-categories"] });
      toast({
        title: "Success",
        description: "Category deleted successfully",
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

  const resetGuideForm = () => {
    setGuideTitle("");
    setGuideDescription("");
    setGuideCategory("");
    setGuideType("html");
    setGuideContent("");
    setScribehowUrl("");
    setVideoUrl("");
    setGuideTags("");
    setIsPublished(true);
    setSelectedGuide(null);
  };

  const resetCategoryForm = () => {
    setCategoryName("");
    setCategoryDescription("");
    setCategoryIcon("");
    setCategoryOrder(0);
    setSelectedCategory(null);
  };

  const handleEditGuide = (guide: UserGuide) => {
    setSelectedGuide(guide);
    setGuideTitle(guide.title);
    setGuideDescription(guide.description || "");
    setGuideCategory(guide.category);
    setGuideType(guide.type as "scribehow" | "html" | "video");
    setGuideContent(guide.content);
    setScribehowUrl(guide.scribehowUrl || "");
    setVideoUrl(guide.videoUrl || "");
    setGuideTags(guide.tags?.join(", ") || "");
    setIsPublished(guide.isPublished || false);
    setIsGuideDialogOpen(true);
  };

  const handleEditCategory = (category: UserGuideCategory) => {
    setSelectedCategory(category);
    setCategoryName(category.name);
    setCategoryDescription(category.description || "");
    setCategoryIcon(category.icon || "");
    setCategoryOrder(category.displayOrder || 0);
    setIsCategoryDialogOpen(true);
  };

  const handleSaveGuide = () => {
    const data = {
      title: guideTitle,
      description: guideDescription,
      category: guideCategory,
      type: guideType,
      content: guideContent,
      scribehowUrl: guideType === "scribehow" ? scribehowUrl : undefined,
      videoUrl: guideType === "video" ? videoUrl : undefined,
      tags: guideTags ? guideTags.split(",").map((tag) => tag.trim()) : [],
      isPublished,
    };

    saveGuideMutation.mutate(data);
  };

  const handleSaveCategory = () => {
    const data = {
      name: categoryName,
      description: categoryDescription,
      icon: categoryIcon,
      displayOrder: categoryOrder,
    };

    saveCategoryMutation.mutate(data);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "scribehow":
        return <BookOpen className="h-4 w-4" />;
      case "video":
        return <Video className="h-4 w-4" />;
      case "html":
        return <FileText className="h-4 w-4" />;
      default:
        return null;
    }
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <MainWrapper
      title="Admin Guide Management"
      subTitle="Create and manage user guides, tutorials, and help documentation"
    >
      <Tabs defaultValue="guides" className="space-y-6">
        <TabsList>
          <TabsTrigger value="guides">Guides</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="guides" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">User Guides</h2>
            <Dialog
              open={isGuideDialogOpen}
              onOpenChange={setIsGuideDialogOpen}
            >
              <DialogTrigger asChild>
                <Button onClick={resetGuideForm}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Guide
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {selectedGuide ? "Edit Guide" : "Create New Guide"}
                  </DialogTitle>
                  <DialogDescription>
                    Add helpful documentation for your users
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={guideTitle}
                      onChange={(e) => setGuideTitle(e.target.value)}
                      placeholder="Guide title"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={guideDescription}
                      onChange={(e) => setGuideDescription(e.target.value)}
                      placeholder="Brief description of the guide"
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Select
                        value={guideCategory}
                        onValueChange={setGuideCategory}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat.id} value={cat.name}>
                              {cat.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="type">Type</Label>
                      <Select
                        value={guideType}
                        onValueChange={(value) => setGuideType(value as any)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="html">HTML Content</SelectItem>
                          <SelectItem value="scribehow">
                            Scribehow Guide
                          </SelectItem>
                          <SelectItem value="video">Video Tutorial</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {guideType === "html" && (
                    <div className="space-y-2">
                      <Label htmlFor="content">HTML Content</Label>
                      <Textarea
                        id="content"
                        value={guideContent}
                        onChange={(e) => setGuideContent(e.target.value)}
                        placeholder="Enter HTML content or paste from Scribehow export"
                        rows={10}
                        className="font-mono text-sm"
                      />
                    </div>
                  )}

                  {guideType === "scribehow" && (
                    <div className="space-y-2">
                      <Label htmlFor="scribehowUrl">Scribehow URL</Label>
                      <Input
                        id="scribehowUrl"
                        type="url"
                        value={scribehowUrl}
                        onChange={(e) => setScribehowUrl(e.target.value)}
                        placeholder="https://scribehow.com/shared/..."
                      />
                      <div className="space-y-2">
                        <Label htmlFor="embedCode">Embed Code</Label>
                        <Textarea
                          id="embedCode"
                          value={guideContent}
                          onChange={(e) => setGuideContent(e.target.value)}
                          placeholder="Paste Scribehow embed code here"
                          rows={6}
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {guideType === "video" && (
                    <div className="space-y-2">
                      <Label htmlFor="videoUrl">Video URL</Label>
                      <Input
                        id="videoUrl"
                        type="url"
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        placeholder="YouTube, Vimeo, or other video URL"
                      />
                      <div className="space-y-2">
                        <Label htmlFor="videoEmbed">Video Embed Code</Label>
                        <Textarea
                          id="videoEmbed"
                          value={guideContent}
                          onChange={(e) => setGuideContent(e.target.value)}
                          placeholder="Paste video embed code here"
                          rows={6}
                          className="font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="tags">Tags (comma-separated)</Label>
                    <Input
                      id="tags"
                      value={guideTags}
                      onChange={(e) => setGuideTags(e.target.value)}
                      placeholder="tutorial, getting-started, advanced"
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="published"
                      checked={isPublished}
                      onCheckedChange={setIsPublished}
                    />
                    <Label htmlFor="published">Published</Label>
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsGuideDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSaveGuide}>
                    {selectedGuide ? "Update" : "Create"} Guide
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Views</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {guidesLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center">
                        Loading guides...
                      </TableCell>
                    </TableRow>
                  ) : guides.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center">
                        No guides found. Create your first guide!
                      </TableCell>
                    </TableRow>
                  ) : (
                    guides.map((guide: UserGuide) => (
                      <TableRow key={guide.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {getTypeIcon(guide.type)}
                            {guide.title}
                          </div>
                        </TableCell>
                        <TableCell>{guide.category}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{guide.type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              guide.isPublished ? "default" : "secondary"
                            }
                          >
                            {guide.isPublished ? (
                              <>
                                <Eye className="h-3 w-3 mr-1" /> Published
                              </>
                            ) : (
                              <>
                                <EyeOff className="h-3 w-3 mr-1" /> Draft
                              </>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>{guide.viewCount}</TableCell>
                        <TableCell>
                          {guide.createdAt
                            ? format(new Date(guide.createdAt), "MMM d, yyyy")
                            : "Unknown"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditGuide(guide)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                confirm(
                                  "Are you sure you want to delete this guide?"
                                )
                              ) {
                                deleteGuideMutation.mutate(guide.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Guide Categories</h2>
            <Dialog
              open={isCategoryDialogOpen}
              onOpenChange={setIsCategoryDialogOpen}
            >
              <DialogTrigger asChild>
                <Button onClick={resetCategoryForm}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {selectedCategory ? "Edit Category" : "Create New Category"}
                  </DialogTitle>
                  <DialogDescription>
                    Organize your guides into categories
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="categoryName">Name</Label>
                    <Input
                      id="categoryName"
                      value={categoryName}
                      onChange={(e) => setCategoryName(e.target.value)}
                      placeholder="Category name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="categoryDescription">Description</Label>
                    <Textarea
                      id="categoryDescription"
                      value={categoryDescription}
                      onChange={(e) => setCategoryDescription(e.target.value)}
                      placeholder="Brief description of the category"
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="categoryIcon">Icon Name (Lucide)</Label>
                    <Input
                      id="categoryIcon"
                      value={categoryIcon}
                      onChange={(e) => setCategoryIcon(e.target.value)}
                      placeholder="e.g., BookOpen, HelpCircle"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="categoryOrder">Display Order</Label>
                    <Input
                      id="categoryOrder"
                      type="number"
                      value={categoryOrder}
                      onChange={(e) =>
                        setCategoryOrder(parseInt(e.target.value) || 0)
                      }
                      placeholder="0"
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsCategoryDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSaveCategory}>
                    {selectedCategory ? "Update" : "Create"} Category
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categoriesLoading ? (
              <div className="col-span-full text-center">
                Loading categories...
              </div>
            ) : categories.length === 0 ? (
              <div className="col-span-full text-center">
                No categories found. Create your first category!
              </div>
            ) : (
              categories.map((category: UserGuideCategory) => (
                <Card key={category.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      {category.name}
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleEditCategory(category)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              confirm(
                                "Are you sure you want to delete this category?"
                              )
                            ) {
                              deleteCategoryMutation.mutate(category.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardTitle>
                    {category.description && (
                      <CardDescription>{category.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">
                      Order: {category.displayOrder}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </MainWrapper>
  );
}
