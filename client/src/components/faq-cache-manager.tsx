import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, Trash2, HelpCircle, Hash, Calendar, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';

export function FaqCacheManager() {
  const { toast } = useToast();
  const [showClearDialog, setShowClearDialog] = useState(false);
  
  const { data: faqs, isLoading } = useQuery({
    queryKey: ['/api/faq-cache'],
    queryFn: async () => {
      const res = await fetch('/api/faq-cache?limit=20');
      if (!res.ok) throw new Error('Failed to fetch FAQ cache');
      return res.json();
    },
  });
  
  const clearCacheMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/faq-cache', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear FAQ cache');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/faq-cache'] });
      toast({
        title: "FAQ cache cleared",
        description: "All cached FAQ responses have been removed.",
      });
      setShowClearDialog(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to clear cache",
        description: error.message,
        variant: "destructive",
      });
    },
  });
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Frequently asked questions are cached to reduce API costs and improve response time.
        </p>
        <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-1" />
              Clear Cache
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear FAQ Cache?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove all cached FAQ responses. The AI will need to regenerate
                answers for frequently asked questions, which may increase costs temporarily.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => clearCacheMutation.mutate()}
                disabled={clearCacheMutation.isPending}
              >
                {clearCacheMutation.isPending ? "Clearing..." : "Clear Cache"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      
      {faqs && faqs.length > 0 ? (
        <div className="space-y-2">
          {faqs.map((faq: any) => (
            <Card key={faq.id} className="border">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <HelpCircle className="h-4 w-4" />
                      {faq.originalQuestion}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {faq.answer.substring(0, 100)}...
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {faq.hitCount} hits
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3" />
                    {faq.questionHash.substring(0, 8)}...
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Last used: {format(new Date(faq.lastUsed), 'MMM d, yyyy')}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-8">
            <HelpCircle className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No cached FAQs yet</p>
            <p className="text-xs text-muted-foreground">
              Frequently asked questions will appear here
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}