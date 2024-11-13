// Import modules
import { readFile } from "fs/promises"
import { processMdxForSearch, type MarkdownSourceType } from "./markdown"

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
		path: path,
		checksum: checksum,
		type: type,
		source: source,
		meta: meta,
		parent_page_path: parentPath,
		sections: sections,
	}
}
