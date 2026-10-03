import { sql } from "drizzle-orm";
import { db } from "../storage/db";

/**
 * Startup data fix-up: make tasks.assignee_type, assignee_id and
 * assignee_team_id agree (one assignee kind, the type set). No NOT NULL or
 * CHECK on assignee_type: production applies the schema with `drizzle-kit
 * push` before the app starts, which would fail on a database that still holds
 * NULL rows. The rule is enforced by the zod schemas and by this fix-up.
 *
 * Only inconsistent rows are written, and updated_at is left alone. Each
 * statement matches rows the previous ones leave alone, so it is idempotent.
 * Logs counts only. Returns the number of rows changed.
 */
export async function migrateAssigneeTypes(): Promise<number> {
  const unset = sql`(assignee_type IS NULL OR assignee_type NOT IN ('user', 'team'))`;
  const statements = [
    // No valid type, a user assignee: a user ticket (the stale team id goes).
    sql`UPDATE tasks SET assignee_type = 'user', assignee_team_id = NULL
        WHERE ${unset} AND assignee_id IS NOT NULL RETURNING id`,
    // No valid type, only a team: a team ticket.
    sql`UPDATE tasks SET assignee_type = 'team'
        WHERE ${unset} AND assignee_id IS NULL AND assignee_team_id IS NOT NULL RETURNING id`,
    // A garbage type and no assignee at all: the column default. (A NULL type
    // with no assignee is a legitimate department-only ticket and stays NULL.)
    sql`UPDATE tasks SET assignee_type = 'user'
        WHERE assignee_type IS NOT NULL AND assignee_type NOT IN ('user', 'team')
          AND assignee_id IS NULL AND assignee_team_id IS NULL RETURNING id`,
    // A team ticket holding a stale user assignee: the team wins.
    sql`UPDATE tasks SET assignee_id = NULL
        WHERE assignee_type = 'team' AND assignee_id IS NOT NULL AND assignee_team_id IS NOT NULL RETURNING id`,
    // A team ticket with no team but a user: really a user ticket.
    sql`UPDATE tasks SET assignee_type = 'user'
        WHERE assignee_type = 'team' AND assignee_id IS NOT NULL AND assignee_team_id IS NULL RETURNING id`,
    // A user ticket holding a stale team id: the user wins.
    sql`UPDATE tasks SET assignee_team_id = NULL
        WHERE assignee_type = 'user' AND assignee_team_id IS NOT NULL AND assignee_id IS NOT NULL RETURNING id`,
    // A user ticket with no user but a team: really a team ticket.
    sql`UPDATE tasks SET assignee_type = 'team'
        WHERE assignee_type = 'user' AND assignee_id IS NULL AND assignee_team_id IS NOT NULL RETURNING id`,
  ];
  let changed = 0;
  for (const statement of statements) {
    changed += (await db.execute(statement)).rows.length;
  }
  if (changed > 0) {
    console.log(`Assignee fix-up: made ${changed} ticket assignment change(s) consistent.`);
  }
  return changed;
}
