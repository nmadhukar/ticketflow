import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A staff member's saved assistant conversations (GET/DELETE /api/assistant/history): a list, a
 * read-only transcript, and Delete. A conversation that mentions a ticket the user can no longer
 * see is withheld by the server and shown as such. Kept 30 days.
 */
interface Thread {
  threadId: string;
  title: string | null;
  updatedAt: string;
}
type Conversation =
  | { available: true; messages: Array<{ role: "user" | "assistant"; text: string; createdAt: string }> }
  | { available: false; reason: string };

const LIST_KEY = ["/api/assistant/history"];
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Transcript({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<Conversation>({ queryKey: ["/api/assistant/history", threadId], staleTime: 0 });

  const remove = async () => {
    setError(null);
    const res = await fetch(`/api/assistant/history/${encodeURIComponent(threadId)}`, { method: "DELETE", credentials: "include" });
    if (!res.ok && res.status !== 404) return setError("Could not delete it. Please try again.");
    await client.invalidateQueries({ queryKey: LIST_KEY });
    onBack();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-2 py-1">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button variant="ghost" size="sm" aria-label="Delete this conversation" onClick={remove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {isLoading && <p className="text-muted-foreground">Loading…</p>}
        {isError && <p className="text-destructive">This conversation could not be loaded.</p>}
        {data && !data.available && (
          <p className="text-muted-foreground">This conversation is no longer available: it mentions a ticket you can no longer see.</p>
        )}
        {data?.available &&
          data.messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-muted p-2" : "mr-8"}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">{when(m.createdAt)}</p>
            </div>
          ))}
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, isError } = useQuery<{ threads: Thread[] }>({ queryKey: LIST_KEY, staleTime: 0 });
  if (open) return <Transcript threadId={open} onBack={() => setOpen(null)} />;
  return (
    <div className="h-full overflow-y-auto p-2 text-sm">
      {isLoading && <p className="p-2 text-muted-foreground">Loading…</p>}
      {isError && <p className="p-2 text-destructive">Saved conversations are unavailable right now.</p>}
      {data && data.threads.length === 0 && <p className="p-2 text-muted-foreground">No saved conversations. They are kept for 30 days.</p>}
      <ul>
        {data?.threads.map((t) => (
          <li key={t.threadId}>
            <button className="w-full rounded-md p-2 text-left hover:bg-muted" onClick={() => setOpen(t.threadId)}>
              <span className="block truncate font-medium">{t.title ?? "Conversation"}</span>
              <span className="text-xs text-muted-foreground">{when(t.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
