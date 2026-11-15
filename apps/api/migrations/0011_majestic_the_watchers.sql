CREATE TABLE "notification_settings" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"email" boolean NOT NULL,
	"in_app" boolean NOT NULL,
	CONSTRAINT "notification_settings_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
ALTER TABLE "activity" DROP CONSTRAINT "activity_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "invites" DROP CONSTRAINT "invites_invited_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_lead_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "activity" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "decisions" ALTER COLUMN "actor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "assignee_deleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_users_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
