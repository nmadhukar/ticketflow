import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertCircle, ArrowUpRight, CheckCircle2, Loader2, Save, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface AISettings {
  modelId: string;
  isActive: boolean;
  openRouterKeyConfigured: boolean;
  autoResponseEnabled: boolean;
  confidenceThreshold: number;
  maxResponseLength: number;
  responseTimeout: number;
  autoLearnEnabled: boolean;
  minResolutionScore: number;
  articleApprovalRequired: boolean;
  temperature: number;
  maxTokens: number;
  maxTokensPerRequest: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
}

const connectionMessages: Record<string, string> = {
  not_configured: "Add OPENROUTER_API_KEY to the server environment and restart the app.",
  auth: "OpenRouter rejected the server key. Check the deployed credential.",
  credits: "OpenRouter credits are unavailable for this account.",
  timeout: "OpenRouter did not respond in time. Try again shortly.",
  rate_limit: "OpenRouter is rate limiting requests. Try again shortly.",
  price_unavailable: "Pricing is unavailable for this model. Choose another model.",
  quota_exceeded: "The test would exceed the configured AI spending limit.",
  invalid_output: "The model returned an invalid response.",
  empty_output: "The model returned no visible text. Try a model with a larger output budget.",
  provider_failure: "OpenRouter could not complete the test. Try again shortly.",
};

function NumberField({ id, label, value, min, max, step = 1, hint, onChange }: {
  id: string; label: string; value: number; min: number; max: number; step?: number;
  hint?: string; onChange: (value: number) => void;
}) {
  return <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} type="number" min={min} max={max} step={step} value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-11 tabular-nums" />
    {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
  </div>;
}

function ToggleRow({ id, title, description, checked, onChange }: {
  id: string; title: string; description: string; checked: boolean; onChange: (value: boolean) => void;
}) {
  return <div className="flex min-h-16 items-center justify-between gap-4 rounded-xl border bg-background/60 px-4 py-3">
    <div className="space-y-1">
      <Label htmlFor={id} className="cursor-pointer font-medium">{title}</Label>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={title} />
  </div>;
}

export default function AISettings() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<AISettings | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const { data, isLoading, isError, refetch } = useQuery<AISettings>({ queryKey: ["/api/ai/settings"] });

  useEffect(() => { if (data) setDraft(data); }, [data]);

  const save = useMutation({
    mutationFn: async (settings: AISettings) => {
      const { openRouterKeyConfigured: _status, ...payload } = settings;
      const response = await apiRequest("POST", "/api/ai/settings", payload);
      return response.json() as Promise<AISettings>;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["/api/ai/settings"], saved);
      setDraft(saved);
      toast({ title: "AI settings saved", description: "The model, workflows, and limits are up to date." });
    },
    onError: (error: Error) => toast({ title: "Settings were not saved", description: error.message, variant: "destructive" }),
  });

  const testConnection = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai/test-connection");
      return response.json() as Promise<{ success: boolean; code?: string }>;
    },
    onSuccess: () => setTestResult({ success: true, message: "OpenRouter answered the test request." }),
    onError: (error: Error & { data?: { code?: string } }) => {
      const code = error.data?.code || "provider_failure";
      setTestResult({ success: false, message: connectionMessages[code] || connectionMessages.provider_failure });
    },
  });

  if (isLoading || !draft) {
    if (isError) return <div className="mx-auto max-w-5xl p-6">
      <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>AI settings are unavailable</AlertTitle><AlertDescription>Check the connection and try again.</AlertDescription></Alert>
      <Button variant="outline" className="mt-4" onClick={() => void refetch()}>Retry</Button>
    </div>;
    return <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">Loading AI settings</span></div>;
  }

  const change = <K extends keyof AISettings>(key: K, value: AISettings[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const dirty = !!data && JSON.stringify(draft) !== JSON.stringify(data);
  const canTest = draft.openRouterKeyConfigured && draft.isActive && !dirty;

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-[0.14em]">Configuration</span></div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">AI settings</h1>
        <p className="max-w-2xl text-sm text-muted-foreground text-pretty">Choose the OpenRouter model, control automatic features, and keep spending within your limits.</p>
      </div>
      <Button asChild variant="outline" className="min-h-10"><Link href="/admin/storage-settings">AWS storage settings <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link></Button>
    </header>

    <Card className="shadow-sm">
      <CardHeader className="space-y-3 sm:flex sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div><CardTitle>OpenRouter connection</CardTitle><CardDescription className="mt-1">The API key stays on the server and is never shown here.</CardDescription></div>
        <Badge variant={draft.openRouterKeyConfigured ? "secondary" : "destructive"} className="w-fit gap-1.5 px-3 py-1.5">
          {draft.openRouterKeyConfigured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {draft.openRouterKeyConfigured ? "Server key configured" : "Server key missing"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {!draft.openRouterKeyConfigured && <Alert><AlertCircle className="h-4 w-4" /><AlertTitle>AI is unavailable</AlertTitle><AlertDescription>Set OPENROUTER_API_KEY in the deployment environment to enable model calls.</AlertDescription></Alert>}
        <ToggleRow id="ai-active" title="Enable AI model calls" description="Turn off model calls without changing the saved configuration." checked={draft.isActive} onChange={(value) => change("isActive", value)} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-2"><Label htmlFor="ai-model">OpenRouter model ID</Label><Input id="ai-model" className="h-11 font-mono text-sm" value={draft.modelId} onChange={(event) => change("modelId", event.target.value)} placeholder="deepseek/deepseek-v4-pro" /><p className="text-sm text-muted-foreground">Use the exact model ID shown by OpenRouter.</p></div>
          <Button type="button" variant="outline" className="min-h-11" disabled={!canTest || testConnection.isPending} onClick={() => { setTestResult(null); testConnection.mutate(); }}>{testConnection.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Test connection</Button>
        </div>
        {dirty && <p className="text-sm text-muted-foreground">Save your changes before testing the connection.</p>}
        {testResult && <Alert variant={testResult.success ? "default" : "destructive"} role="status">{testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}<AlertTitle>{testResult.success ? "Connection successful" : "Connection failed"}</AlertTitle><AlertDescription>{testResult.message}</AlertDescription></Alert>}
      </CardContent>
    </Card>

    <Card className="shadow-sm">
      <CardHeader><CardTitle>Ticket workflows</CardTitle><CardDescription>Control when Ticketflow responds and learns from resolved work.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow id="auto-response" title="Automatic responses" description="Prepare replies when new tickets qualify." checked={draft.autoResponseEnabled} onChange={(value) => change("autoResponseEnabled", value)} />
          <ToggleRow id="auto-learn" title="Learn from resolved tickets" description="Build knowledge suggestions from completed work." checked={draft.autoLearnEnabled} onChange={(value) => change("autoLearnEnabled", value)} />
          <ToggleRow id="approval-required" title="Require article approval" description="A person reviews AI-generated articles before publishing." checked={draft.articleApprovalRequired} onChange={(value) => change("articleApprovalRequired", value)} />
        </div>
        <div className="grid gap-5 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField id="confidence" label="Reply confidence (%)" value={Math.round(draft.confidenceThreshold * 100)} min={0} max={100} hint="Minimum confidence for automatic replies." onChange={(value) => change("confidenceThreshold", value / 100)} />
          <NumberField id="response-length" label="Reply length (characters)" value={draft.maxResponseLength} min={100} max={5000} onChange={(value) => change("maxResponseLength", value)} />
          <NumberField id="response-timeout" label="Response timeout (seconds)" value={draft.responseTimeout} min={5} max={120} onChange={(value) => change("responseTimeout", value)} />
          <NumberField id="resolution-score" label="Learning quality (%)" value={Math.round(draft.minResolutionScore * 100)} min={0} max={100} onChange={(value) => change("minResolutionScore", value / 100)} />
        </div>
      </CardContent>
    </Card>

    <Card className="shadow-sm">
      <CardHeader><CardTitle>Model and spending limits</CardTitle><CardDescription>Requests are checked against these limits before the model is called. Costs remain estimates until OpenRouter confirms billing.</CardDescription></CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField id="daily-limit" label="Daily limit (USD)" value={draft.dailyLimitUsd} min={0} max={1000000} step={0.01} onChange={(value) => change("dailyLimitUsd", value)} />
        <NumberField id="monthly-limit" label="Monthly limit (USD)" value={draft.monthlyLimitUsd} min={0} max={1000000} step={0.01} onChange={(value) => change("monthlyLimitUsd", value)} />
        <NumberField id="request-tokens" label="Tokens per request" value={draft.maxTokensPerRequest} min={1} max={1000000} onChange={(value) => change("maxTokensPerRequest", value)} />
        <NumberField id="output-tokens" label="Maximum output tokens" value={draft.maxTokens} min={100} max={4000} onChange={(value) => change("maxTokens", value)} />
        <NumberField id="temperature" label="Temperature" value={draft.temperature} min={0} max={1} step={0.1} hint="Lower values produce more consistent responses." onChange={(value) => change("temperature", value)} />
      </CardContent>
    </Card>

    <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <p className="text-sm text-muted-foreground" role="status">{dirty ? "You have unsaved changes." : "All changes saved."}</p>
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => setDraft(data ?? draft)}>Discard</Button><Button type="button" disabled={!dirty || save.isPending || !draft.modelId.trim()} onClick={() => save.mutate(draft)}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save settings</Button></div>
    </div>
  </main>;
}
