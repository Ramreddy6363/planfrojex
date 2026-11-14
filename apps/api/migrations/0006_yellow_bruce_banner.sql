CREATE TABLE "diagram_versions" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"diagram_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"scene" jsonb NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagrams" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"scene" jsonb DEFAULT '{"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"scene_version" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "diagram_id" uuid;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "diagram_versions" ADD CONSTRAINT "diagram_versions_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagram_versions" ADD CONSTRAINT "diagram_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagram_versions_diagram_version_idx" ON "diagram_versions" USING btree ("diagram_id","version");--> statement-breakpoint
CREATE INDEX "diagrams_project_idx" ON "diagrams" USING btree ("project_id","deleted_at");--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_diagram_id_diagrams_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."diagrams"("id") ON DELETE set null ON UPDATE no action;