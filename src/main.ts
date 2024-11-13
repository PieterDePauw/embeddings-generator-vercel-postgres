/* eslint-disable no-console */
/* eslint-disable object-shorthand */
import * as core from "@actions/core"
import { eq, ne } from "drizzle-orm"
import { createPool } from "@vercel/postgres"
import { drizzle } from "drizzle-orm/vercel-postgres"
import { createOpenAI } from "@ai-sdk/openai"
import { embed } from "ai"
import { v4 as uuidv4 } from "uuid"
import { walk } from "./sources/util"
import { MarkdownSource } from "./sources/markdown"
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

async function generateEmbeddings({ databaseUrl, openaiApiKey, docsRootPath }: { databaseUrl: string; openaiApiKey: string; docsRootPath: string }): Promise<void> {
	// Initialize OpenAI client
	const openaiClient = createOpenAI({ apiKey: openaiApiKey, compatibility: "strict" })

	// const client = createClient({ connectionString: databaseUrl })
	// const db = drizzle(client)

	// Create a connection pool to the database
	const pool = createPool({
		connectionString: databaseUrl,
		ssl: { rejectUnauthorized: false },
		max: 1,
	})

	// Create a Drizzle instance
	const db = drizzle(pool)

	const refreshVersion = uuidv4()
	const refreshDate = new Date()

	const ignoredFiles = ["pages/404.mdx"]

	const files = await walk(docsRootPath)
	const markdownFiles = files.filter(({ path }) => /\.(md|mdx)$/.test(path)).filter(({ path }) => !ignoredFiles.includes(path))

	const sources = await Promise.all(
		markdownFiles.map(async ({ path, parentPath }) => {
			const source = new MarkdownSource("markdown", path, parentPath)
			const sourcePart2 = await source.load()
			return Object.assign(source, sourcePart2, {})
		}),
	)

	console.log(`Discovered ${sources.length} pages.`)

	for (const source of sources) {
		try {
			const [existingPage] = await db.select().from(documents).where(eq(documents.path, source.path)).limit(1)
			// const existingPageId: string = existingPage?.id

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
				// Embed the content of the section
				const { value, embedding, usage } = await embed({
					model: openaiClient.embedding("text-embedding-3-small", { dimensions: 1536, user: "drizzle" }),
					value: section.content.replace(/\n/g, " "),
				})

				const insertPageData: InsertPageSection = {
					id: uuidv4(),
					page_id: existingPage?.id || newId,
					heading: section.heading,
					slug: section.slug,
					content: section.content || value,
					embedding: embedding,
					token_count: usage.tokens,
				}

				await db.insert(documentSections).values(insertPageData)
			}
		} catch (error) {
			console.error(`Error processing ${source.path}:`, error)
		}
	}

	// Cleanup old pages
	await db.delete(documents).where(ne(documents.version, refreshVersion))

	console.log("Embedding generation complete.")
}

async function run(): Promise<void> {
	try {
		// Get the inputs
		const databaseUrl: string | undefined = core.getInput("database-url")
		const openaiApiKey: string | undefined = core.getInput("openai-api-key")
		const docsRootPath: string = core.getInput("docs-root-path") || "docs/"

		// Check if the inputs are provided
		if (!databaseUrl || !openaiApiKey) {
			throw new Error("The inputs 'database-url' and 'openai-api-key' must be provided.")
		}

		// Generate embeddings
		await generateEmbeddings({ databaseUrl: databaseUrl, openaiApiKey: openaiApiKey, docsRootPath: docsRootPath })
	} catch (error) {
		core.setFailed(error.message)
	}
}

run()
