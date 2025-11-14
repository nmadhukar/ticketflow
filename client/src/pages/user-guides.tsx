import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import Header from "@/components/header";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  BookOpen,
  Video,
  FileText,
  Eye,
  ChevronRight,
  Tag,
} from "lucide-react";
import { format } from "date-fns";
import type { UserGuide, UserGuideCategory } from "@shared/schema";
import MainWrapper from "@/components/main-wrapper";

export default function UserGuides() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedGuide, setSelectedGuide] = useState<UserGuide | null>(null);

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
  const { data: guides = [], isLoading: guidesLoading } = useQuery({
    queryKey: ["/api/guides", { published: "true" }],
    queryFn: async () => {
      const response = await fetch("/api/guides?published=true", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch guides");
      return response.json();
    },
    retry: false,
    enabled: isAuthenticated,
  });

  // Fetch categories
  const { data: categories = [], isLoading: categoriesLoading } = useQuery<
    UserGuideCategory[]
  >({
    queryKey: ["/api/guide-categories"],
    retry: false,
    enabled: isAuthenticated,
  });

  // Fetch single guide when selected
  const { data: guideDetails, isLoading: guideDetailsLoading } = useQuery({
    queryKey: ["/api/guides", selectedGuide?.id],
    queryFn: async () => {
      const response = await fetch(`/api/guides/${selectedGuide?.id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch guide details");
      return response.json();
    },
    enabled: !!selectedGuide?.id,
  });

  // Filter guides based on search and category
  const filteredGuides = guides.filter((guide: UserGuide) => {
    const matchesSearch =
      !searchQuery ||
      guide.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guide.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      guide.tags?.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      );

    const matchesCategory =
      !selectedCategory || guide.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Group guides by category
  const guidesByCategory = filteredGuides.reduce(
    (acc: Record<string, UserGuide[]>, guide: UserGuide) => {
      if (!acc[guide.category]) {
        acc[guide.category] = [];
      }
      acc[guide.category].push(guide);
      return acc;
    },
    {}
  );

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

  const renderGuideContent = (guide: UserGuide) => {
    if (guide.type === "scribehow" || guide.type === "video") {
      // Render embed code directly
      return (
        <div
          dangerouslySetInnerHTML={{ __html: guide.content }}
          className="guide-content"
        />
      );
    } else {
      // Render HTML content
      return (
        <div
          dangerouslySetInnerHTML={{ __html: guide.content }}
          className="guide-content prose max-w-none"
        />
      );
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
    <MainWrapper>
      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search guides..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar with categories */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Categories</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="space-y-1">
                <Button
                  variant={selectedCategory === null ? "secondary" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => setSelectedCategory(null)}
                >
                  All Categories
                </Button>
                {categories.map((category: UserGuideCategory) => (
                  <Button
                    key={category.id}
                    variant={
                      selectedCategory === category.name ? "secondary" : "ghost"
                    }
                    className="w-full justify-start"
                    onClick={() => setSelectedCategory(category.name)}
                  >
                    {category.name}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main content area */}
        <div className="lg:col-span-3">
          {selectedGuide ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedGuide(null)}
                  >
                    ← Back to guides
                  </Button>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    {guideDetails?.viewCount || selectedGuide.viewCount} views
                  </div>
                </div>
                <CardTitle className="text-2xl mt-4">
                  {selectedGuide.title}
                </CardTitle>
                {selectedGuide.description && (
                  <CardDescription className="text-base mt-2">
                    {selectedGuide.description}
                  </CardDescription>
                )}
                <div className="flex items-center gap-4 mt-4">
                  <Badge variant="secondary">
                    {getTypeIcon(selectedGuide.type)}
                    <span className="ml-1">{selectedGuide.type}</span>
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {format(
                      new Date(selectedGuide?.createdAt || ""),
                      "MMMM d, yyyy"
                    )}
                  </span>
                </div>
                {selectedGuide.tags && selectedGuide.tags.length > 0 && (
                  <div className="flex items-center gap-2 mt-3">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    {selectedGuide.tags.map((tag, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {guideDetailsLoading ? (
                  <div className="text-center py-8">
                    Loading guide content...
                  </div>
                ) : guideDetails ? (
                  renderGuideContent(guideDetails)
                ) : (
                  renderGuideContent(selectedGuide)
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {filteredGuides.length === 0 ? (
                <Card>
                  <CardContent className="text-center py-12">
                    <p className="text-muted-foreground">
                      No guides found matching your search criteria.
                    </p>
                  </CardContent>
                </Card>
              ) : selectedCategory ? (
                // Show guides for selected category
                <div className="space-y-4">
                  <h2 className="text-xl font-semibold">{selectedCategory}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {guidesByCategory[selectedCategory]?.map(
                      (guide: UserGuide) => (
                        <Card
                          key={guide.id}
                          className="cursor-pointer hover:shadow-lg transition-shadow"
                          onClick={() => setSelectedGuide(guide)}
                        >
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <CardTitle className="text-lg flex items-center gap-2">
                                  {getTypeIcon(guide.type)}
                                  {guide.title}
                                </CardTitle>
                                {guide.description && (
                                  <CardDescription className="mt-2">
                                    {guide.description}
                                  </CardDescription>
                                )}
                              </div>
                              <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center justify-between text-sm text-muted-foreground">
                              <span>
                                {guide.createdAt
                                  ? format(
                                      new Date(guide.createdAt),
                                      "MMM d, yyyy"
                                    )
                                  : "Unknown"}
                              </span>
                              <div className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                {guide.viewCount}
                              </div>
                            </div>
                            {guide.tags && guide.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {guide.tags.slice(0, 3).map((tag, index) => (
                                  <Badge
                                    key={index}
                                    variant="outline"
                                    className="text-xs"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {guide.tags.length > 3 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{guide.tags.length - 3}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )
                    )}
                  </div>
                </div>
              ) : (
                // Show all guides grouped by category
                Object.entries(guidesByCategory).map(
                  ([category, categoryGuides]) => (
                    <div key={category} className="space-y-4">
                      <h2 className="text-xl font-semibold">{category}</h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {(categoryGuides as UserGuide[]).map(
                          (guide: UserGuide) => (
                            <Card
                              key={guide.id}
                              className="cursor-pointer hover:shadow-lg transition-shadow"
                              onClick={() => setSelectedGuide(guide)}
                            >
                              <CardHeader>
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                      {getTypeIcon(guide.type)}
                                      {guide.title}
                                    </CardTitle>
                                    {guide.description && (
                                      <CardDescription className="mt-2">
                                        {guide.description}
                                      </CardDescription>
                                    )}
                                  </div>
                                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                </div>
                              </CardHeader>
                              <CardContent>
                                <div className="flex items-center justify-between text-sm text-muted-foreground">
                                  <span>
                                    {guide.createdAt
                                      ? format(
                                          new Date(guide.createdAt),
                                          "MMM d, yyyy"
                                        )
                                      : "Unknown"}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <Eye className="h-3 w-3" />
                                    {guide.viewCount}
                                  </div>
                                </div>
                                {guide.tags && guide.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {guide.tags
                                      .slice(0, 3)
                                      .map((tag, index) => (
                                        <Badge
                                          key={index}
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                    {guide.tags.length > 3 && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        +{guide.tags.length - 3}
                                      </Badge>
                                    )}
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          )
                        )}
                      </div>
                    </div>
                  )
                )
              )}
            </div>
          )}
        </div>
      </div>
    </MainWrapper>
  );
}
