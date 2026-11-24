CREATE TABLE "external_links" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"integration_id" uuid NOT NULL,
	"milestone_id" uuid,
	"task_id" uuid,
	"external_id" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_links_one_target" CHECK (num_nonnulls("external_links"."milestone_id", "external_links"."task_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text DEFAULT 'linear' NOT NULL,
	"encrypted_credentials" text,
	"organization_id" text,
	"team_id" text,
	"name" text,
	"states" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status_mapping" jsonb DEFAULT '{"planning":null,"in_progress":null,"completed":null,"archived":null}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{"pushMilestones":false,"pullStatus":true,"importIssues":false}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"oauth_state_hash" text,
	"oauth_expires_at" timestamp with time zone,
	"oauth_user_id" text,
	"webhook_receipts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_oauth_user_id_users_id_fk" FOREIGN KEY ("oauth_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_integration_external_idx" ON "external_links" USING btree ("integration_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_integration_milestone_idx" ON "external_links" USING btree ("integration_id","milestone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_integration_task_idx" ON "external_links" USING btree ("integration_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_workspace_provider_idx" ON "integrations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_oauth_state_idx" ON "integrations" USING btree ("oauth_state_hash");--> statement-breakpoint
CREATE INDEX "integrations_provider_org_idx" ON "integrations" USING btree ("provider","organization_id");