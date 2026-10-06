import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, HardDrive, Loader2, Save, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StorageSettings {
  bedrockAccessKeyId: string;
  bedrockRegion: string;
  bedrockModelId: string;
  hasBedrockSecret: boolean;
}

export default function StorageSettings() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<StorageSettings | null>(null);
  const [newSecret, setNewSecret] = useState("");
  const { data, isLoading, isError, refetch } = useQuery<StorageSettings>({ queryKey: ["/api/storage/aws-settings"] });

  useEffect(() => { if (data) setDraft(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Settings are not loaded");
      const response = await apiRequest("POST", "/api/storage/aws-settings", {
        bedrockAccessKeyId: draft.bedrockAccessKeyId.trim(),
        bedrockRegion: draft.bedrockRegion.trim(),
        bedrockModelId: draft.bedrockModelId.trim(),
        ...(newSecret ? { bedrockSecretAccessKey: newSecret } : {}),
      });
      return response.json() as Promise<StorageSettings>;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(["/api/storage/aws-settings"], saved);
      setDraft(saved);
      setNewSecret("");
      toast({ title: "Storage settings saved", description: "Attachment storage credentials are up to date." });
    },
    onError: (error: Error) => toast({ title: "Storage settings were not saved", description: error.message, variant: "destructive" }),
  });

  if (isLoading || !draft) return <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
    {isError ? <div role="alert"><p className="font-medium">Storage settings are unavailable.</p><Button className="mt-3" variant="outline" onClick={() => void refetch()}>Retry</Button></div>
      : <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">Loading storage settings</span></div>}
  </main>;

  const dirty = !!data && (newSecret.length > 0 || draft.bedrockAccessKeyId !== data.bedrockAccessKeyId || draft.bedrockRegion !== data.bedrockRegion || draft.bedrockModelId !== data.bedrockModelId);
  const update = (key: keyof StorageSettings, value: string) => setDraft((current) => current ? { ...current, [key]: value } : current);

  return <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
    <header className="space-y-3">
      <Button asChild variant="ghost" className="-ml-3 min-h-10"><Link href="/admin/ai-settings"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />AI settings</Link></Button>
      <div className="flex items-center gap-2 text-primary"><HardDrive className="h-5 w-5" aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-[0.14em]">Configuration</span></div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">AWS storage settings</h1>
      <p className="max-w-2xl text-sm text-muted-foreground text-pretty">Configure AWS credentials for ticket attachments. These settings are separate from OpenRouter model access.</p>
    </header>

    <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Credentials stay on the server</AlertTitle><AlertDescription>The secret is never sent back to this page. Leave the secret field blank to keep the saved value.</AlertDescription></Alert>

    <Card className="shadow-sm">
      <CardHeader className="space-y-3 sm:flex sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div><CardTitle>Attachment storage</CardTitle><CardDescription className="mt-1">S3 access credentials are retained in the existing AWS settings record.</CardDescription></div>
        <Badge variant="secondary" className="w-fit gap-1.5 px-3 py-1.5">{draft.hasBedrockSecret && <CheckCircle2 className="h-3.5 w-3.5" />}{draft.hasBedrockSecret ? "Secret configured" : "Secret missing"}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2"><Label htmlFor="aws-access-key">AWS access key ID</Label><Input id="aws-access-key" autoComplete="off" className="h-11 font-mono text-sm" value={draft.bedrockAccessKeyId} onChange={(event) => update("bedrockAccessKeyId", event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="aws-secret">AWS secret access key</Label><Input id="aws-secret" type="password" autoComplete="new-password" className="h-11" value={newSecret} onChange={(event) => setNewSecret(event.target.value)} placeholder={draft.hasBedrockSecret ? "Saved secret will be kept" : "Enter a secret access key"} /><p className="text-sm text-muted-foreground">{draft.hasBedrockSecret ? "A secret is saved. Enter a new one only to replace it." : "A secret is required for S3 operations."}</p></div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="aws-region">AWS region</Label><Input id="aws-region" className="h-11 font-mono text-sm" value={draft.bedrockRegion} onChange={(event) => update("bedrockRegion", event.target.value)} placeholder="us-east-1" /><p className="text-sm text-muted-foreground">S3 uses AWS_S3_REGION when the server sets it. Otherwise it uses a region saved here other than us-east-1, and failing that us-east-2. A saved us-east-1 is ignored; set AWS_S3_REGION to use it.</p></div>
          <div className="space-y-2"><Label htmlFor="legacy-model">Legacy Bedrock model</Label><Input id="legacy-model" className="h-11 font-mono text-sm" value={draft.bedrockModelId} onChange={(event) => update("bedrockModelId", event.target.value)} /><p className="text-sm text-muted-foreground">Retained only for rollback to the previous image.</p></div>
        </div>
      </CardContent>
    </Card>

    <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <p className="text-sm text-muted-foreground" role="status">{dirty ? "You have unsaved changes." : "All changes saved."}</p>
      <div className="flex gap-2"><Button variant="outline" disabled={!dirty || save.isPending} onClick={() => { setDraft(data ?? draft); setNewSecret(""); }}>Discard</Button><Button disabled={!dirty || save.isPending || !draft.bedrockAccessKeyId.trim() || !draft.bedrockRegion.trim()} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save storage settings</Button></div>
    </div>
  </main>;
}
