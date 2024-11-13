/* eslint-disable no-console */
/* eslint-disable object-shorthand */
import * as core from "@actions/core"
import { readFile } from "fs/promises"
import { eq, ne } from "drizzle-orm"
import { createPool } from "@vercel/postgres"
import { drizzle } from "drizzle-orm/vercel-postgres"
import { createOpenAI } from "@ai-sdk/openai"
import { embed } from "ai"
import { v4 as uuidv4 } from "uuid"
import { walk } from "./sources/util"
import { processMdxForSearch, type Section, type Json } from "./sources/markdown"
import { pages as documents, pageSections as documentSections, type InsertPageSection } from "./db/schema"

// interface Page {
// 	id: string
// 	path: string
// 	checksum: string | null
// 	parent_id: string | null
// 	meta: Record<string, any> | null
// 	version: string
// 	last_refresh: Date
// }

// interface PageSection {
// 	id: string
// 	page_id: string
// 	heading: string | null
// 	slug: string | null
// 	content: string
// 	embedding: number[]
// 	token_count: number
// }

// Define the MarkdownSourceType
export type MarkdownSourceType = { path: string; checksum: string; type: string; source: string; meta?: Json; parent_page_path?: string; sections: Section[] }

// Define the generateSources function
async function generateSources({ docsRootPath, ignoredFiles = ["pages/404.mdx"] }: { docsRootPath: string; ignoredFiles: string[] }): Promise<MarkdownSourceType[]> {
	// Walk through the docs root path
	const embeddingSources = await Promise.all(
		(await walk(docsRootPath))
			.filter(({ path }) => /\.mdx?$/.test(path))
			.filter(({ path }) => !ignoredFiles.includes(path))
			.map((entry) => generateMarkdownSource(entry.path, entry.parentPath)),
	)

	// Log the number of discovered pages
	console.log(`Discovered ${embeddingSources.length} pages`)

	// Return the embedding sources
	return embeddingSources
}

/**
 * Asynchronously creates a markdown source object by reading and processing a markdown file.
 * @param filePath - The file path to the markdown file.
 * @param parentFilePath - The optional file path to the parent markdown file.
 * @returns An object containing the path, checksum, type, source, meta, parent page path, and sections.
 */
export async function generateMarkdownSource(filePath: string, parentFilePath?: string): Promise<MarkdownSourceType> {
	// Extract the path and parent path
	const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
	const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")

	// Define the source and type
	const source = "markdown"
	const type = "markdown"

	// Read the file contents asynchronously
	const contents = await readFile(filePath, "utf8")

	// Process the contents of the MDX file for search and extract the checksum, meta, and sections
	const { checksum, meta, sections } = processMdxForSearch(contents)

	// Return the desired object
	return {
		path: filePath,
		checksum: checksum,
		type: type,
		source: source,
		meta: meta,
		parent_page_path: parentFilePath,
		sections: sections,
	}
}

// Main function to generate embeddings
async function generateEmbeddings({ databaseUrl, openaiApiKey, docsRootPath }: { databaseUrl: string; openaiApiKey: string; docsRootPath: string }): Promise<void> {
	// > Initialize OpenAI client
	const openaiClient = createOpenAI({ apiKey: openaiApiKey, compatibility: "strict" })

	// > Create a connection pool to the database
	const pool = createPool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 })

	// > Create a Drizzle instance
	const db = drizzle(pool)

	// > Create a new refresh version and a new refresh date
	const refreshVersion = uuidv4()
	const refreshDate = new Date()

	// > Create a list of ignored files
	const ignoredFiles = ["pages/404.mdx"]

	const sources = await generateSources({ docsRootPath, ignoredFiles })
	// .map((entry) => new MarkdownSource("markdown", entry.path, entry.parentPath))

	// const sources = await Promise.all(
	// 	markdownFiles.map(async ({ path, parentPath }) => {
	// 		const { filePath, parentFilePath, source, type } = new MarkdownSource("markdown", path, parentPath)
	// 		const { checksum, meta, sections } = await source.load()
	// 		return { path: filePath, checksum: checksum, type: type, source: source, meta: meta, parent_page_path: parentFilePath, sections: sections }
	// 	}),
	// )

	// > Log the number of pages discovered
	// console.log(`Discovered ${sources.length} pages.`)

	// > Process each source file and generate embeddings
	for (const source of sources) {
		try {
			const [existingPage] = await db.select().from(documents).where(eq(documents.path, source.path)).limit(1)

			const newId: string = uuidv4()

			const pageData = {
				path: source.path,
				checksum: source.checksum,
				parent_id: null, // Handle parent page logic if applicable
				meta: source.meta,
				version: refreshVersion,
				last_refresh: refreshDate,
			}

			if (existingPage) {
				if (existingPage.checksum === source.checksum) {
					console.log(`No changes detected for ${source.path}`)
					continue
				}
				// Update existing page
				await db.update(documents).set(pageData).where(eq(documents.id, existingPage.id)).returning()
				// Delete existing sections
				await db.delete(documentSections).where(eq(documentSections.page_id, existingPage.id)).returning()
			} else {
				// Insert new page
				await db.insert(documents).values({ ...pageData, id: newId })
				// const newPage: Page = (await db.insert(documents).values({ ...pageData, id: newId }).returning())[0]
				// existingPageId = newPage.id
			}

			console.log(`Processing ${source.path}`)

			// Generate embeddings
			const { sections } = source

			for (const section of sections) {
				// Assign the content to a constant
				const input = section.content.replace(/\n/g, " ")

				// Embed the content of the section
				const { value, embedding, usage } = await embed({ model: openaiClient.embedding("text-embedding-3-small", { dimensions: 1536, user: "drizzle" }), value: input })

				// Insert the section into the database
				await db.insert(documentSections).values({
					id: uuidv4(),
					page_id: existingPage?.id || newId,
					heading: section.heading,
					slug: section.slug,
					content: section.content || value,
					embedding: embedding,
					token_count: usage.tokens,
				})
			}
		} catch (error) {
			console.error(`Error processing ${source.path}:`, error)
		}
	}

	// Cleanup old pages
	await db.delete(documents).where(ne(documents.version, refreshVersion))

	console.log("Embedding generation complete.")
}

// Function to run the action
async function run(): Promise<void> {
	try {
		// > Get the inputs
		const databaseUrl: string | undefined = core.getInput("database-url")
		const openaiApiKey: string | undefined = core.getInput("openai-api-key")
		const docsRootPath: string = core.getInput("docs-root-path") || "docs/"

		// > Check if the inputs are provided
		if (!databaseUrl || !openaiApiKey) {
			throw new Error("The inputs 'database-url' and 'openai-api-key' must be provided.")
		}

		// > Generate embeddings
		await generateEmbeddings({ databaseUrl: databaseUrl, openaiApiKey: openaiApiKey, docsRootPath: docsRootPath })
	} catch (error) {
		// > Log the error
		core.setFailed(error.message)
	}
}

// Run the action
run()
