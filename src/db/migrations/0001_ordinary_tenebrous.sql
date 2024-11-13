CREATE TABLE IF NOT EXISTS "document_sections" (
	"id" varchar PRIMARY KEY NOT NULL,
	"document_id" varchar NOT NULL,
	"slug" text NOT NULL,
	"heading" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" varchar PRIMARY KEY NOT NULL,
	"path" text NOT NULL,
	"checksum" text,
	"type" text,
	"source" text,
	"meta" text,
	"parent_document_path" text,
	"version" varchar,
	"last_refresh" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "documents_path_unique" UNIQUE("path")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_document_path_documents_path_fk" FOREIGN KEY ("parent_document_path") REFERENCES "public"."documents"("path") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
