CREATE TABLE "review_approvals" (
	"reviewer_id" uuid NOT NULL,
	"section" text NOT NULL,
	"revision" text NOT NULL,
	"outcome" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_approvals_reviewer_id_section_pk" PRIMARY KEY("reviewer_id","section")
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_by" text,
	"share_token_hash" text NOT NULL,
	"due_date" date,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviewers" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_code_hash" text,
	"verification_code_expires_at" timestamp with time zone,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewers_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "review_approvals" ADD CONSTRAINT "review_approvals_reviewer_id_reviewers_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."reviewers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewers" ADD CONSTRAINT "reviewers_request_id_review_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."review_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_requests_project_created_idx" ON "review_requests" USING btree ("project_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviewers_request_email_idx" ON "reviewers" USING btree ("request_id","email");