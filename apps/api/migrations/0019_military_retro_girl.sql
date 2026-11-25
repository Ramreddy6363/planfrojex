ALTER TABLE "email_unsubscribes" ADD COLUMN "share_review_request_id" uuid;--> statement-breakpoint
ALTER TABLE "status_report_deliveries" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
UPDATE "email_unsubscribes" AS grants SET "share_review_request_id" = deliveries."review_request_id" FROM "status_report_deliveries" AS deliveries WHERE grants."delivery_id" = deliveries."id" AND grants."share_token_hash" IS NOT NULL AND deliveries."review_request_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ADD CONSTRAINT "email_unsubscribes_share_review_request_id_review_requests_id_fk" FOREIGN KEY ("share_review_request_id") REFERENCES "public"."review_requests"("id") ON DELETE set null ON UPDATE no action;
