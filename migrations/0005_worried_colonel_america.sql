CREATE TABLE "team_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"granted_by" varchar NOT NULL,
	"granted_at" timestamp DEFAULT now(),
	"permissions" text[],
	CONSTRAINT "unique_team_admin" UNIQUE("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "team_task_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"assigned_user_id" varchar,
	"assigned_by" varchar NOT NULL,
	"assigned_at" timestamp DEFAULT now(),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"completed_at" timestamp,
	"notes" text,
	"priority" varchar(20)
);
--> statement-breakpoint
ALTER TABLE "email_providers" ALTER COLUMN "provider" SET DEFAULT 'mailtrap';--> statement-breakpoint
ALTER TABLE "team_admins" ADD CONSTRAINT "team_admins_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_admins" ADD CONSTRAINT "team_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_admins" ADD CONSTRAINT "team_admins_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_assignments" ADD CONSTRAINT "team_task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_assignments" ADD CONSTRAINT "team_task_assignments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_assignments" ADD CONSTRAINT "team_task_assignments_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_task_assignments" ADD CONSTRAINT "team_task_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_team_admins_team_user" ON "team_admins" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_team_admins_user" ON "team_admins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_team_admins_team" ON "team_admins" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_task_assignments_task" ON "team_task_assignments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_team_task_assignments_user" ON "team_task_assignments" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "idx_team_task_assignments_team" ON "team_task_assignments" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_task_assignments_task_status" ON "team_task_assignments" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "idx_team_task_assignments_team_user" ON "team_task_assignments" USING btree ("team_id","assigned_user_id");
--> statement-breakpoint
-- Drop role column from team_members table (no longer needed)
ALTER TABLE "team_members" DROP COLUMN IF EXISTS "role";