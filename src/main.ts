/* eslint-disable no-console */
/* eslint-disable object-shorthand */
import dotenv from "dotenv"
import * as core from "@actions/core"
import { readFile } from "node:fs/promises"
import { eq, ne } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { createOpenAI } from "@ai-sdk/openai"
import { embed } from "ai"
import { v4 as uuid } from "uuid"
import { walk, processMdxForSearch, type Section, type Json } from "./sources/markdown"
import { documents, documentSections, type DocumentType, type DocumentSectionType } from "./db/schema"

// Load the environment variables
dotenv.config({ path: ".env.local" })

// Define the MarkdownSourceType
export type MarkdownSourceType = { path: string; checksum: string; type: string; source: string; meta?: Json; parent_document_path: string | null; sections: Section[] }

// Define the Singular type
export type Singular<T> = T extends unknown[] ? undefined : T

// Define the generateSources function
async function generateSources({ docsRootPath, ignoredFiles = ["pages/404.mdx"] }: { docsRootPath: string; ignoredFiles: string[] }): Promise<MarkdownSourceType[]> {
	// > Walk through the docs root path
	const embeddingSources = await Promise.all(
		(await walk(docsRootPath))
			.filter(({ path }) => /\.mdx?$/.test(path))
			.filter(({ path }) => !ignoredFiles.includes(path))
			.map(({ path, parentPath }) => generateMarkdownSource(path, parentPath)),
	)

	// > Log the number of discovered pages
	console.log(`Discovered ${embeddingSources.length} pages`)

	// > Return the embedding sources
	return embeddingSources
}

/**
 * Asynchronously creates a markdown source object by reading and processing a markdown file.
 * @param filePath - The file path to the markdown file.
 * @param parentFilePath - The optional file path to the parent markdown file.
 * @returns An object containing the path, checksum, type, source, meta, parent page path, and sections.
 */
export async function generateMarkdownSource(filePath: string, parentFilePath?: string): Promise<MarkdownSourceType> {
	// > Extract the path and parent path
	// const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
	// const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")

	// > Read the file contents asynchronously
	const contents: string = await readFile(filePath, "utf8")

	// > Process the contents of the MDX file for search and extract the checksum, meta, and sections
	const { checksum, meta, sections } = processMdxForSearch(contents)

	// > Return the desired object
	return { path: filePath, checksum: checksum, type: "markdown", source: "markdown", meta: meta, parent_document_path: parentFilePath, sections: sections }
}

// Main function to generate embeddings
// prettier-ignore
async function generateEmbeddings({ databaseUrl, openaiApiKey, docsRootPath, shouldRefresh }: { databaseUrl: string; openaiApiKey: string; docsRootPath: string, shouldRefresh: boolean }): Promise<void> {
	// > Initialize OpenAI client
	const openaiClient = createOpenAI({ apiKey: openaiApiKey, compatibility: "strict" })

	// > Create a Drizzle instance
    const db = drizzle({ connection: { connectionString: databaseUrl, ssl: true } })

	// > Create a new refresh version and a new refresh date
	const refreshVersion = uuid()
	const refreshDate = new Date()

	// > Create a list of ignored files
	const ignoredFiles = ["pages/404.mdx"]

	// > Generate the markdown source files
	const sourceFiles = await generateSources({ docsRootPath, ignoredFiles })

	// > If the shouldRefresh flag is true, delete all existing documents and document sections
	if (shouldRefresh) {
		// >> Log the refresh operation to the console
		console.log("Refresh flag detected: deleting existing documents and document sections...")
		// >> Delete all existing documents from the database by default
		const deletedDocuments = await db.delete(documents).returning()
		// >> Delete all existing document sections from the database by default
		const deletedDocumentSections = await db.delete(documentSections).returning()
		// >> Log the completion of the deletion process
		console.log("Deletion complete")
		console.log(`Deleted documents (${deletedDocuments.length})`)
		deletedDocuments.forEach((deletedDocument) => console.log(`– ${deletedDocument.path}`))
		console.log(`Deleted document sections (${deletedDocumentSections.length})`)
		deletedDocumentSections.forEach((deletedDocumentSection) => console.log(`– ${deletedDocumentSection.id}`))


		// >> Iterate over all source files and insert new documents and document sections
		for (const currentSourceFile of sourceFiles) {
			// >>> Insert the document into the database
			// prettier-ignore
			const [newDocument] = await db.insert(documents).values({ ...currentSourceFile, id: uuid() }).returning() as DocumentType[]
			// >>> Iterate over all sections of the document and insert them into the database
			for (const section of currentSourceFile.sections) {
				// >>>> Process the content of the section to optimize the token count for the embedding
				const input = section.content.replace(/\n/g, " ")
				// >>>> Generate an embedding for the content of the section
				const { value, embedding, usage } = await embed({ model: openaiClient.embedding("text-embedding-3-small", { dimensions: 1536, user: "drizzle" }), value: input })
				// >>>> Insert the document section into the database
				// prettier-ignore
				const [newDocumentSections] = await db.insert(documentSections).values({ id: uuid(), document_id: newDocument.id, heading: section.heading, slug: section.slug, content: section.content || value, embedding: embedding, token_count: usage.tokens }).returning() as DocumentSectionType[]
			}
		}
	}

	// > If the shouldRefresh flag is false, process each source file and generate embeddings for the content of the sections of the document files that have changed
	if (!shouldRefresh) {
		// >> Log the refresh operation to the console
		console.log("Checking which documents have changed...")

		// >> Iterate over all source files and process each file to generate embeddings for the content of the sections of the document files that have changed
		for (const currentSourceFile of sourceFiles) {
			try {
				// >>> Try to find the current document in the database by its path
				// const [foundDocument] = await db.select().from(documents).where(eq(documents.path, source.path)).limit(1)
				// prettier-ignore
				const [foundDocument] = await db.select({ id: documents.id, path: documents.path, meta: documents.meta, checksum: documents.checksum, parentDocument: { id: documents.id, path: documents.path } }).from(documents).where(eq(documents.path, currentSourceFile.path)).limit(1)

				// >>> If the document does not exist, ...
				// prettier-ignore
				if (!foundDocument) {
					// >>>> Insert a new document into the database
					// prettier-ignore
					const [newDocument] = (await db.insert(documents).values({ ...currentSourceFile, id: uuid() }).returning()) as DocumentType[]
					// >>>> Iterate over all sections of the new document and insert them into the database
					for (const section of currentSourceFile.sections) {
						// >>>>> Process the content of the section to optimize the token count for the embedding
						const input = section.content.replace(/\n/g, " ")
						// >>>>> Generate an embedding for the content of the section
						const { value, embedding, usage } = await embed({ model: openaiClient.embedding("text-embedding-3-small", { dimensions: 1536, user: "drizzle" }), value: input })
						// >>>>> Insert the document section into the database
						// prettier-ignore
						const [newDocumentSections] = (await db.insert(documentSections).values({ id: uuid(), document_id: newDocument.id, heading: section.heading, slug: section.slug, content: section.content || value, embedding: embedding, token_count: usage.tokens }).returning()) as DocumentSectionType[]
					}
				}

				// >>> If the document exists, ...
				if (foundDocument) {
					// >>>> Check if the checksum of the document has changed
					const isDocumentChanged = foundDocument.checksum !== currentSourceFile.checksum
					// >>>>> Check if the parent document path has changed
					const isParentPathChanged = foundDocument.parentDocument?.path !== currentSourceFile.parent_document_path

					// >>>> If the checksum has not changed, skip the document
					if (!isDocumentChanged) {
						// >>>>> If the parent page path has not changed, skip the document
						if (!isParentPathChanged) {
							console.log(`No changes detected for ${currentSourceFile.path}`)
							continue
						}

						// >>>>> If the parent page path has changed, update the parent page path of the document
						if (isParentPathChanged) {
							// >>>>>>> Find the parent document by the parent page path of the current source file
							// prettier-ignore
							const [parentDocument] = await db.select().from(documents).where(eq(documents.path, currentSourceFile.parent_document_path)).limit(1)
							// >>>>> Create an updated document object with the new parent document ID
							const updateDataObject = { ...foundDocument, parentDocument: parentDocument.path }
							// >>>>> Update the parent page id and the parent page path of the document in the database
							const [updatedDocument] = await db.update(documents).set(updateDataObject).where(eq(documents.id, foundDocument.id)).returning()
							// >>>>> Log the completion of the update process
							console.log(`Only updated the parent page path for ${updatedDocument.path}`)
						}
					}

					// >>>> If the checksum has changed, update the document, delete any existing document sections, and insert new embeddings for the document sections
					if (isDocumentChanged) {
					    // >>>>> Create an updated document object
						const updateDataObject = { ...foundDocument, ...currentSourceFile }
						// >>>>> Update the existing document
						const [updatedDocument]: DocumentType[] = await db.update(documents).set(updateDataObject).where(eq(documents.id, foundDocument.id)).returning()
						console.log(`Updated document ${updatedDocument.path}`)
						// >>>>> Delete the existing document sections associated with the document's ID
						const deletedDocumentSections: DocumentSectionType[] = await db.delete(documentSections).where(eq(documentSections.document_id, foundDocument.id)).returning()
						// >>>>> Log the completion of the deletion process
						console.log(`--> Deleted document sections (${deletedDocumentSections.length})`)
						// >>>>> Insert new document sections
						for (const { heading, slug, content } of currentSourceFile.sections) {
							// >>>>>> Process the content of the section to optimize the token count for the embedding
							const input = content.replace(/\n/g, " ")

							// >>>>>> Generate an embedding for the content of the section
							// prettier-ignore
							const { value, embedding, usage } = await embed({ model: openaiClient.embedding("text-embedding-3-small", { dimensions: 1536, user: "drizzle" }), value: input })

							// >>>>>> Insert the document section into the database
							// prettier-ignore
							const [newDocumentSection] = await db.insert(documentSections).values({ id: uuid(), document_id: foundDocument.id, heading: heading, slug: slug, content: content || value, embedding: embedding, token_count: usage.tokens }).returning()
							// >>>>>> Log the completion of the insertion process
							console.log(`--> Inserted document section ${newDocumentSection.id}`)
						}
					}
				}
			} catch (error) {
				// >>> If an error occurs, log the error to the console
				console.error(`Error processing ${currentSourceFile.path}:`, error)
			}
		}

		// >> Cleanup old pages
		await db.delete(documents).where(ne(documents.version, refreshVersion))

		// >> Log the completion of the embedding generation process
		console.log("Embedding generation complete.")
	}
}

// Function to run the action
async function run(): Promise<void> {
	try {
		// >> Get the inputs
		const databaseUrl = core.getInput("database-url") || process.env.DATABASE_URL
		const openaiApiKey = core.getInput("openai-api-key") || process.env.OPENAI_API_KEY
		const docsRootPath = core.getInput("docs-root-path") || "docs/"

		console.log("Database URL:", databaseUrl)
		console.log("OpenAI API Key:", openaiApiKey)

		// > Determine the state of the shouldRefresh flag
		const shouldRefresh: boolean = false

		// >> Check if the inputs are provided
		if (!databaseUrl || !openaiApiKey) throw new Error("The inputs 'database-url' and 'openai-api-key' must be provided.")

		// >> Generate embeddings
		await generateEmbeddings({ databaseUrl: databaseUrl, openaiApiKey: openaiApiKey, docsRootPath: docsRootPath, shouldRefresh: shouldRefresh })
	} catch (error) {
		// >> Log the error
		core.setFailed(error.message)
	}
}

// Run the action
run()
