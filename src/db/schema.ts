// Import modules
import { AnyPgColumn, pgTable, text, timestamp, integer, vector, varchar /* serial, jsonb */ } from "drizzle-orm/pg-core"

// Define a table for pages
// prettier-ignore
export const documents = pgTable("documents", {
	id: varchar("id").primaryKey(),
	path: text("path").notNull().unique(),
	checksum: text("checksum"),
	type: text("type"),
	source: text("source"),
	meta: text("meta"),
	parent_page_path: text("parent_page_path").references((): AnyPgColumn => documents.path),
	version: varchar("version"),
	last_refresh: timestamp("last_refresh").defaultNow(),
	created_at: timestamp("created_at").notNull().defaultNow(),
	updated_at: timestamp("updated_at").notNull().$onUpdate(() => new Date()),
})

// Define a table for page sections
// prettier-ignore
export const documentSections = pgTable("document_sections", {
	id: varchar("id").primaryKey(),
	page_id: varchar("page_id").references((): AnyPgColumn => documents.id).notNull(),
	slug: text("slug").notNull(),
	heading: text("heading").notNull(),
	content: text("content").notNull(),
	token_count: integer("token_count").notNull(),
	embedding: vector("embedding", { dimensions: 1536 }).notNull(),
})

// Assign the inferred types for the documents table to the corresponding type aliases
export type DocumentType = typeof documents.$inferSelect
export type SelectDocumentType = typeof documents.$inferSelect
export type InsertDocumentType = typeof documents.$inferInsert

// Assign the inferred types for the documentSections table to the corresponding type aliases
export type DocumentSectionType = typeof documentSections.$inferSelect
export type SelectDocumentSectionType = typeof documentSections.$inferSelect
export type InsertDocumentSectionType = typeof documentSections.$inferInsert

// Export schema type
// export type DbSchema = typeof pages & typeof pageSections
