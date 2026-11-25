CREATE TABLE "status_report_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT planfrojex_uuidv7() NOT NULL,
	"report_id" uuid NOT NULL,
	"recipient_hash" text NOT NULL,
	"share_include" text[],
	"share_token_hash" text,
	"report" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ADD COLUMN "delivery_id" uuid;--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ADD COLUMN "share_token_hash" text;--> statement-breakpoint
ALTER TABLE "status_report_deliveries" ADD CONSTRAINT "status_report_deliveries_report_id_status_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."status_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "status_report_deliveries_recipient_idx" ON "status_report_deliveries" USING btree ("report_id","recipient_hash");--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ADD CONSTRAINT "email_unsubscribes_delivery_id_status_report_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."status_report_deliveries"("id") ON DELETE cascade ON UPDATE no action;