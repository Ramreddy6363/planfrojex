CREATE TABLE "email_unsubscribes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"recipient_hash" text NOT NULL,
	"unsubscribed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "status_reports" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"week" date NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"body" jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"recipients_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ADD CONSTRAINT "email_unsubscribes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_reports" ADD CONSTRAINT "status_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_unsubscribes_project_recipient_idx" ON "email_unsubscribes" USING btree ("project_id","recipient_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "email_unsubscribes_project_recipient_active_idx" ON "email_unsubscribes" USING btree ("project_id","recipient_hash") WHERE "email_unsubscribes"."unsubscribed_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "status_reports_project_week_idx" ON "status_reports" USING btree ("project_id","week");