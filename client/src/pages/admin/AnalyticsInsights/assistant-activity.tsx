import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { ASSISTANT_AUDIT_EVENT_TYPES } from "@shared/schema";

/**
 * Admin view of the in-app assistant: runs and their outcomes, what they cost (from ai_usage, the
 * one record of AI spend), and the audit trail of proposed and confirmed writes and refusals.
 * Neither holds conversation content. Server: server/assistant/admin.ts.
 */
interface UsageResponse {
  days: number;
  totals: {
    runs: number;
    byStatus: Record<"completed" | "failed" | "stopped" | "refused", number>;
    proposals: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  runs: Array<{ day: string; agentId: string; status: string; runs: number; proposals: number; avgDurationMs: number }>;
  cost: Array<{ day: string; operation: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }>;
}

interface AuditEvent {
  id: number;
  occurredAt: string;
  eventType: string;
  actorUserId: string | null;
  agentId: string | null;
  runId: string | null;
  proposalId: string | null;
  ticketId: number | null;
  reason: string | null;
}

const AGENT_LABEL: Record<string, string> = { "support-assistant": "Support", "ticket-assistant": "Staff" };
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  stopped: "secondary",
  failed: "destructive",
  refused: "outline",
};

async function getJson<T>(url: string): Promise<T> {
  return (await apiRequest("GET", url)).json();
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const count = (n: number) => n.toLocaleString();

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {note && <CardContent className="pt-0 text-xs text-muted-foreground">{note}</CardContent>}
    </Card>
  );
}

function UsageSection() {
  const [days, setDays] = useState("30");
  const { data, isLoading, isError } = useQuery<UsageResponse>({
    queryKey: [`/api/admin/assistant/usage?days=${days}`],
    queryFn: () => getJson(`/api/admin/assistant/usage?days=${days}`),
    staleTime: 60_000,
  });
  const t = data?.totals;

  return (
    <section aria-labelledby="assistant-usage" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="assistant-usage" className="text-lg font-semibold">
          Usage
        </h2>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24 hours</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isError && <p className="text-sm text-destructive">Assistant usage could not be loaded.</p>}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {t && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Runs"
              value={count(t.runs)}
              note={`${count(t.byStatus.completed)} completed · ${count(t.byStatus.failed)} failed · ${count(t.byStatus.stopped)} stopped · ${count(t.byStatus.refused)} refused`}
            />
            <Stat label="Drafts proposed" value={count(t.proposals)} note="Tickets and comments offered for confirmation" />
            <Stat label="Tokens" value={count(t.inputTokens + t.outputTokens)} note={`${count(t.inputTokens)} in · ${count(t.outputTokens)} out`} />
            <Stat label="Cost" value={usd(t.costUsd)} note="Counts towards the AI budgets in AI settings" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Runs by day</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assistant runs in this period.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Assistant</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Drafts</TableHead>
                      <TableHead className="text-right">Avg. time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data.runs].reverse().map((r) => (
                      <TableRow key={`${r.day}-${r.agentId}-${r.status}`}>
                        <TableCell className="whitespace-nowrap">{r.day}</TableCell>
                        <TableCell>{AGENT_LABEL[r.agentId] ?? r.agentId}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>{r.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{count(r.runs)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(r.proposals)}</TableCell>
                        <TableCell className="text-right tabular-nums">{(r.avgDurationMs / 1000).toFixed(1)} s</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function AuditSection() {
  const [event, setEvent] = useState<string>("all");
  const base = `/api/admin/assistant/audit?limit=50${event === "all" ? "" : `&event=${event}`}`;
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: [base],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => getJson<{ events: AuditEvent[]; nextBefore: number | null }>(pageParam ? `${base}&before=${pageParam}` : base),
    getNextPageParam: (last) => last.nextBefore,
    staleTime: 30_000,
  });
  const events = data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <section aria-labelledby="assistant-audit" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="assistant-audit" className="text-lg font-semibold">
          Audit trail
        </h2>
        <Select value={event} onValueChange={setEvent}>
          <SelectTrigger className="w-48" aria-label="Event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            {ASSISTANT_AUDIT_EVENT_TYPES.map((e) => (
              <SelectItem key={e} value={e}>
                {e.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          {isError && <p className="text-sm text-destructive">The audit trail could not be loaded.</p>}
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && !isError && events.length === 0 && <p className="text-sm text-muted-foreground">No events.</p>}
          {events.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Assistant</TableHead>
                  <TableHead>Ticket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</TableCell>
                    <TableCell className="whitespace-nowrap">{e.eventType.replace(/_/g, " ")}</TableCell>
                    <TableCell>{e.reason ?? "—"}</TableCell>
                    <TableCell className="max-w-[12rem] truncate font-mono text-xs" title={e.actorUserId ?? undefined}>
                      {e.actorUserId ?? "—"}
                    </TableCell>
                    <TableCell>{e.agentId ? (AGENT_LABEL[e.agentId] ?? e.agentId) : "—"}</TableCell>
                    <TableCell className="tabular-nums">{e.ticketId ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {hasNextPage && (
            <Button variant="outline" className="mt-4" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default function AssistantActivityPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Assistant activity</h1>
        <p className="text-sm text-muted-foreground">
          How the in-app assistant is used, what it costs, and every write it proposed. No conversation content is stored here.
        </p>
      </div>
      <UsageSection />
      <AuditSection />
    </div>
  );
}
