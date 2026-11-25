ALTER TABLE "email_unsubscribes" DROP CONSTRAINT "email_unsubscribes_delivery_id_status_report_deliveries_id_fk";
--> statement-breakpoint
ALTER TABLE "status_report_deliveries" ADD COLUMN "review_request_id" uuid;--> statement-breakpoint
ALTER TABLE "email_unsubscribes" ADD CONSTRAINT "email_unsubscribes_delivery_id_status_report_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."status_report_deliveries"("id") ON DELETE set null ON UPDATE no action;