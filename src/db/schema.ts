// Import modules
import { AnyPgColumn, pgTable, text, timestamp, integer, vector, varchar /* serial, jsonb */ } from "drizzle-orm/pg-core"

// Define a table for pages
// prettier-ignore
export const pages = pgTable("pages", {
	id: varchar("id").primaryKey(),
	path: text("path").notNull().unique(),
	checksum: text("checksum"),
	type: text("type"),
	source: text("source"),
	meta: text("meta"),
	parent_page_path: text("parent_page_path").references((): AnyPgColumn => pages.path),
	version: varchar("version"),
	last_refresh: timestamp("last_refresh").defaultNow(),
	created_at: timestamp("created_at").notNull().defaultNow(),
	updated_at: timestamp("updated_at").notNull().$onUpdate(() => new Date()),
})

// Define a table for page sections
// prettier-ignore
export const pageSections = pgTable("page_sections", {
	id: varchar("id").primaryKey(),
	page_id: varchar("page_id").references((): AnyPgColumn => pages.id).notNull(),
	slug: text("slug").notNull(),
	heading: text("heading").notNull(),
	content: text("content").notNull(),
	token_count: integer("token_count").notNull(),
	embedding: vector("embedding", { dimensions: 1536 }).notNull(),
})

// Assign the inferred types for the documents table to the corresponding type aliases
export type Page = typeof pages.$inferSelect
export type SelectPage = typeof pages.$inferSelect
export type InsertPage = typeof pages.$inferInsert

// Assign the inferred types for the documentSections table to the corresponding type aliases
export type PageSection = typeof pageSections.$inferSelect
export type SelectPageSection = typeof pageSections.$inferSelect
export type InsertPageSection = typeof pageSections.$inferInsert

// Export schema type
// export type DbSchema = typeof pages & typeof pageSections
