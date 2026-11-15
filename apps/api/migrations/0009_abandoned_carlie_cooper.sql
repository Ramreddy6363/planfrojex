CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"activity_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_activity_type_idx" ON "notifications" USING btree ("user_id","activity_id","type");--> statement-breakpoint
CREATE INDEX "notifications_user_workspace_read_created_idx" ON "notifications" USING btree ("user_id","workspace_id","read_at","created_at" DESC NULLS LAST);