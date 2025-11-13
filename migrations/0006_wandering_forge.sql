CREATE TABLE "user_preferences" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'light',
	"language" varchar(10) DEFAULT 'en',
	"timezone" varchar(100) DEFAULT 'UTC',
	"date_format" varchar(20) DEFAULT 'MM/DD/YYYY',
	"email_notifications" boolean DEFAULT true,
	"push_notifications" boolean DEFAULT false,
	"task_updates" boolean DEFAULT true,
	"team_updates" boolean DEFAULT true,
	"mentions" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "department_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;