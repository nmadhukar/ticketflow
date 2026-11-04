import type { Express, RequestHandler } from "express";
import { and, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { ASSISTANT_AUDIT_EVENT_TYPES, aiUsage, assistantAuditEvents, assistantUsageEvents } from "@shared/schema";

/**
 * Admin-only views of the assistant: usage (runs, outcomes, tokens and cost) and the audit trail.
 * Session only (bearer credentials are refused on /api/admin by setupAuth's allowlist). Nothing
 * here returns conversation content: the tables hold none.
 *
 *   GET /api/admin/assistant/usage?days=30           (1-90)
 *   GET /api/admin/assistant/audit?limit=50&before=<id>&event=<type>&user=<id>
 */

function intParam(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

// The app's own admin check (middleware/admin.middleware.ts), as every other admin route uses.
// Loaded on first use, like the database: importing it reaches storage.
const isAdmin: RequestHandler = (req, res, next) => {
  import("../middleware/admin.middleware").then(({ isAdmin: check }) => check(req, res, next), next);
};

export function registerAssistantAdminRoutes(app: Express): void {
  app.get("/api/admin/assistant/usage", isAdmin, async (req, res, next) => {
    const days = intParam(req.query.days, 30, 1, 90);
    if (days === null) return res.status(400).json({ error: "validation_failed", message: "days must be an integer from 1 to 90." });
    try {
      const { db } = await import("../storage/db");
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const day = sql<string>`to_char(date_trunc('day', ${assistantUsageEvents.startedAt}), 'YYYY-MM-DD')`;
      const runs = await db
        .select({
          day,
          agentId: assistantUsageEvents.agentId,
          status: assistantUsageEvents.status,
          runs: sql<number>`count(*)::int`,
          proposals: sql<number>`coalesce(sum(${assistantUsageEvents.proposalCount}), 0)::int`,
          avgDurationMs: sql<number>`coalesce(avg(${assistantUsageEvents.durationMs}), 0)::int`,
        })
        .from(assistantUsageEvents)
        .where(gte(assistantUsageEvents.startedAt, since))
        .groupBy(day, assistantUsageEvents.agentId, assistantUsageEvents.status)
        .orderBy(day);

      // Cost lives in ai_usage alone; assistant rows carry assistant_run_id.
      const costDay = sql<string>`to_char(date_trunc('day', ${aiUsage.timestamp}), 'YYYY-MM-DD')`;
      const cost = await db
        .select({
          day: costDay,
          operation: aiUsage.operation,
          model: aiUsage.modelId,
          inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
          costUsd: sql<string>`coalesce(sum(case when ${aiUsage.billingStatus} = 'verified' and ${aiUsage.verifiedCostUsd} is not null then ${aiUsage.verifiedCostUsd} else ${aiUsage.estimatedCost} end), 0)::text`,
        })
        .from(aiUsage)
        .where(and(isNotNull(aiUsage.assistantRunId), gte(aiUsage.timestamp, since)))
        .groupBy(costDay, aiUsage.operation, aiUsage.modelId)
        .orderBy(costDay);

      const totals = {
        runs: runs.reduce((n, r) => n + r.runs, 0),
        byStatus: Object.fromEntries(["completed", "failed", "stopped", "refused"].map((s) => [s, runs.filter((r) => r.status === s).reduce((n, r) => n + r.runs, 0)])),
        proposals: runs.reduce((n, r) => n + r.proposals, 0),
        inputTokens: cost.reduce((n, c) => n + c.inputTokens, 0),
        outputTokens: cost.reduce((n, c) => n + c.outputTokens, 0),
        costUsd: Number(cost.reduce((n, c) => n + Number(c.costUsd), 0).toFixed(6)),
      };
      res.json({ days, since: since.toISOString(), totals, runs, cost: cost.map((c) => ({ ...c, costUsd: Number(c.costUsd) })) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/assistant/audit", isAdmin, async (req, res, next) => {
    const limit = intParam(req.query.limit, 50, 1, 200);
    const before = intParam(req.query.before, 0, 1, Number.MAX_SAFE_INTEGER);
    const event = req.query.event;
    const userId = req.query.user;
    if (limit === null || before === null) return res.status(400).json({ error: "validation_failed", message: "limit (1-200) and before must be positive integers." });
    if (event !== undefined && !(ASSISTANT_AUDIT_EVENT_TYPES as readonly unknown[]).includes(event)) {
      return res.status(400).json({ error: "validation_failed", message: `event must be one of: ${ASSISTANT_AUDIT_EVENT_TYPES.join(", ")}.` });
    }
    if (userId !== undefined && (typeof userId !== "string" || !/^[A-Za-z0-9._:@-]{1,255}$/.test(userId))) {
      return res.status(400).json({ error: "validation_failed", message: "user must be a user id." });
    }
    try {
      const { db } = await import("../storage/db");
      const conditions = [
        before ? lt(assistantAuditEvents.id, before) : undefined,
        event ? eq(assistantAuditEvents.eventType, event as string) : undefined,
        userId ? eq(assistantAuditEvents.actorUserId, userId as string) : undefined,
      ].filter((c): c is NonNullable<typeof c> => c !== undefined);
      const rows = await db
        .select()
        .from(assistantAuditEvents)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(assistantAuditEvents.id))
        .limit(limit);
      res.json({ events: rows, nextBefore: rows.length === limit ? rows[rows.length - 1].id : null });
    } catch (error) {
      next(error);
    }
  });
}
