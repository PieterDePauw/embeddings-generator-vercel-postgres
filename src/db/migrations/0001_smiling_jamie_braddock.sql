CREATE TABLE IF NOT EXISTS "page_sections" (
	"id" varchar PRIMARY KEY NOT NULL,
	"page_id" varchar NOT NULL,
	"slug" text NOT NULL,
	"heading" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pages" (
	"id" varchar PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"checksum" text,
	"type" text,
	"source" text,
	"meta" text,
	"parent_page_path" text,
	"version" varchar,
	"last_refresh" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "pages_path_unique" UNIQUE("path")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "page_sections" ADD CONSTRAINT "page_sections_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_page_path_pages_path_fk" FOREIGN KEY ("parent_page_path") REFERENCES "public"."pages"("path") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
