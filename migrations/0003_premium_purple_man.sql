DROP TABLE IF EXISTS "smtp_settings";
--> statement-breakpoint
CREATE TABLE "email_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(20) DEFAULT 'aws-ses' NOT NULL,
	"from_email" varchar(255) NOT NULL,
	"from_name" varchar(255) DEFAULT 'TicketFlow' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" varchar,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "email_providers" ADD CONSTRAINT "email_providers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;