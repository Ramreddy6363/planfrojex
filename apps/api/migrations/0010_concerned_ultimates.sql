CREATE FUNCTION planfrojex_search_tags(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT array_to_string($1, ' ') $$;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("key", '')), 'A') || setweight(to_tsvector('simple', coalesce("brief", '{}'::jsonb)), 'B') || setweight(to_tsvector('simple', planfrojex_search_tags("tags")), 'C')) STORED;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title", '')), 'A') || setweight(to_tsvector('simple', coalesce("description", '')), 'B')) STORED;--> statement-breakpoint
CREATE INDEX "projects_search_idx" ON "projects" USING gin ("search");--> statement-breakpoint
CREATE INDEX "tasks_search_idx" ON "tasks" USING gin ("search");