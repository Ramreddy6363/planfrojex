CREATE TABLE "drift_reports" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"draft_id" uuid,
	"findings" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"checked_against_linear_at" timestamp with time zone,
	"linear_destination" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drift_reports_draft_id_unique" UNIQUE("draft_id")
);
--> statement-breakpoint
DROP INDEX "draft_changes_draft_kind_idx";--> statement-breakpoint
ALTER TABLE "draft_changes" ADD COLUMN "drift_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_links" ADD COLUMN "source_milestone_id" uuid;--> statement-breakpoint
ALTER TABLE "drift_reports" ADD CONSTRAINT "drift_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_reports" ADD CONSTRAINT "drift_reports_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drift_reports_project_created_idx" ON "drift_reports" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "drift_reports_project_open_idx" ON "drift_reports" USING btree ("project_id") WHERE "drift_reports"."status" = 'open';--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_source_milestone_id_milestones_id_fk" FOREIGN KEY ("source_milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "draft_changes_draft_kind_idx" ON "draft_changes" USING btree ("draft_id","kind","drift_key");