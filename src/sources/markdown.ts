/* eslint-disable import/no-unresolved */
/* eslint-disable no-shadow */
/* eslint-disable no-console */
/* eslint-disable object-shorthand */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import GithubSlugger from "github-slugger"
import { readFile, readdir, stat } from "fs/promises"
import { basename, dirname, join } from "path"
import { createHash } from "crypto"
import { ObjectExpression } from "estree"
import { Content, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { mdxFromMarkdown, type MdxjsEsm } from "mdast-util-mdx"
import { toMarkdown } from "mdast-util-to-markdown"
import { toString } from "mdast-util-to-string"
import { mdxjs } from "micromark-extension-mdxjs"
import { u } from "unist-builder"
import { filter } from "unist-util-filter"

/**
 * Types
 */
export type Json = Record<string, string | number | boolean | null | Json[] | { [key: string]: Json }>
export type Section = { content: string; heading?: string; slug?: string }

/**
 * Walks a directory and returns all files in the directory and subdirectories.
 * @param dir - The directory to walk.
 * @param parentPath - The optional parent path for the next iteration.
 * @returns Promise that resolves to an array of objects containing the path and optional parent path.
 */
export async function walk(directory: string, parentPath?: string): Promise<{ path: string; parentPath?: string }[]> {
	// > Read the contents of the directory
	const immediateFiles = await readdir(directory)

	// > Recursively walk the directory and return all files in the directory and subdirectories
	const recursiveFiles = await Promise.all(
		// >> For each file in the directory, ...
		immediateFiles.map(async (file) => {
			// >>> Construct the full path to the file
			const path = join(directory, file)
			// >>> Get the file stats
			const stats = await stat(path)

			// >>> If the file is a directory, recursively walk the directory
			if (stats.isDirectory()) {
				// >>>> Construct the name of the corresponding .mdx file
				const docPath = `${basename(path)}.mdx`
				// >>>> Construct the parent path for the next iteration
				const nextParentPath = immediateFiles.includes(docPath) ? join(dirname(path), docPath) : parentPath
				// >>>> Recursively walk the directory with the next path and parent path
				return walk(path, nextParentPath)
			}
			// >>> If the file is a file, return the file path
			if (stats.isFile()) {
				return [{ path, parentPath }]
			}

			// >>> If the file is not a file or directory, return an empty array
			return []
		}),
	)

	// > Log a message to the console indicating that the directory has been walked
	console.log(`Walked all files in ${directory}: ${recursiveFiles.flat().length} files found`)

	// > Return the flattened array of files sorted by path name
	return recursiveFiles.reduce((all, folderContents) => all.concat(folderContents), []).sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Extracts ES literals from an `estree` `ObjectExpression`
 * into a plain JavaScript object.
 */
export function getObjectFromExpression(node: ObjectExpression) {
	// > Reduce the properties of the object expression into a plain object
	return node.properties.reduce<Record<string, string | number | bigint | true | RegExp | undefined>>((object, property) => {
		// >> If the type of the property is not "Property", return the object as is
		if (property.type !== "Property") return object

		// >> Extract the key and value of the property
		const key = (property.key.type === "Identifier" && property.key.name) || undefined
		const value = (property.value.type === "Literal" && property.value.value) || undefined

		// >> If the key is not a truthy value, return the object as is
		if (!key) return object

		// >> If the key is a truthy value, return the object with the key-value pair appended to it
		return { ...object, [key]: value }
	}, {})
}

/**
 * Extracts the `meta` ESM export from the MDX file.
 *
 * This info is akin to frontmatter.
 */
export function extractMetaExport(mdxTree: Root) {
	// > Find the `meta` export node in the MDX tree
	const metaExportNode = mdxTree.children.find((node): node is MdxjsEsm => {
		return (
			node.type === "mdxjsEsm" &&
			node.data?.estree?.body[0]?.type === "ExportNamedDeclaration" &&
			node.data.estree.body[0].declaration?.type === "VariableDeclaration" &&
			node.data.estree.body[0].declaration.declarations[0]?.id.type === "Identifier" &&
			node.data.estree.body[0].declaration.declarations[0].id.name === "meta"
		)
	})

	// > If there's no `meta` export node, return undefined
	if (!metaExportNode) {
		return undefined
	}

	// > Extract the `ObjectExpression` from the `meta` export node
	const objectExpression =
		(metaExportNode.data?.estree?.body[0]?.type === "ExportNamedDeclaration" &&
			metaExportNode.data.estree.body[0].declaration?.type === "VariableDeclaration" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0]?.id.type === "Identifier" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].id.name === "meta" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].init?.type === "ObjectExpression" &&
			metaExportNode.data.estree.body[0].declaration.declarations[0].init) ||
		undefined

	// > If there's no `ObjectExpression`, return undefined
	if (!objectExpression) {
		return undefined
	}

	// > Return the object extracted from the `ObjectExpression`
	return getObjectFromExpression(objectExpression)
}

/*
 * Splits a `mdast` tree into multiple trees based on
 * a predicate function. Will include the splitting node
 * at the beginning of each tree.
 *
 * Useful to split a markdown file into smaller sections.
 */
export function splitTreeBy(tree: Root, predicate: (node: Content) => boolean) {
	// > Reduce the children of the tree into an array of trees
	return tree.children.reduce<Root[]>((trees: Root[], node: Content) => {
		// >> Get the last tree in the array
		const [lastTree] = trees.slice(-1)

		// >> If there's no last tree or the predicate is true for the current node
		if (!lastTree || predicate(node)) {
			// >>> Create a new tree with the current node
			const newTree: Root = u("root", [node])

			// >>> Return the array with the new
			return trees.concat(newTree)
		}

		// >> Push the current node as a child of the last tree
		lastTree.children.push(node)

		// >> Return the array with the last tree
		return trees
	}, [])
}

/**
 * Parses a markdown heading which can optionally
 * contain a custom anchor in the format:
 *
 * ```markdown
 * ### My Heading [#my-custom-anchor]
 * ```
 */
export function parseHeading(heading: string): { heading: string; customAnchor?: string } {
	// > Match the heading against a regular expression
	const match = heading.match(/(.*) *\[#(.*)\]/)
	// > If there's a match, return the heading and the custom anchor
	if (match) {
		const [, heading, customAnchor] = match
		return { heading: heading, customAnchor: customAnchor }
	}
	// > If there's no match, return just the heading
	return { heading: heading }
}

/**
 * Generates a slug from a heading string or a custom anchor.
 */
export function generateSlug({ heading, customAnchor }: { heading: string; customAnchor?: string }): string {
	// > Create a new slugger instance to generate slugs
	const slugger = new GithubSlugger()
	// > Create a slug from the heading or custom anchor and return it
	const slug = slugger.slug(customAnchor ?? heading)
	// > Return the slug or the heading without special characters and with all spaces replaced by hyphens
	return slug || heading.replace(/[^a-zA-Z0-9 ]/g, "").replace(/ +/g, "-")
}

/**
 * Processes MDX content for search indexing.
 * It extracts metadata, strips it of all JSX,
 * and splits it into sub-sections based on criteria.
 */
export function processMdxForSearch(content: string): { checksum: string; meta: Json; sections: Section[] } {
	// > Create a hash of the content to use as a checksum
	const checksum: string = createHash("sha256").update(content).digest("base64")

	// > Parse the MDX content into a MDX tree
	const mdxTree = fromMarkdown(content, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] })

	// > Extract metadata from the MDX tree
	const meta = extractMetaExport(mdxTree)

	// > Serialize the metadata to make it JSON serializable
	const serializableMeta: Json = meta && JSON.parse(JSON.stringify(meta))

	// > Filter out JSX nodes from the MDX tree (so we only have markdown nodes)
	const mdTree = filter(mdxTree, (node) => !["mdxjsEsm", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxFlowExpression", "mdxTextExpression"].includes(node.type))

	// > If there's no markdown tree, return an empty object
	if (!mdTree) return { checksum: checksum, meta: serializableMeta, sections: [] }

	// > Split the markdown tree into sections based on headings
	const sectionTrees = splitTreeBy(mdTree, (node) => node.type === "heading")

	// > Generate sections from the section trees by extracting the heading and content of each section
	const sections: Section[] = sectionTrees.map((sectionTree) => {
		// >> Get the first node of the section tree
		const [firstNode] = sectionTree.children

		// >> Convert the section tree to markdown to get the content
		const content = toMarkdown(sectionTree)

		// >> Check if the first node has a type property set to "heading"
		const rawHeading: string | undefined = firstNode.type === "heading" ? toString(firstNode) : undefined

		// >> If it isn't a heading, just return the content
		if (!rawHeading) return { content: content }

		// >> If it is a heading, parse the raw heading to extract the heading and possibly a custom anchor
		const { heading, customAnchor } = parseHeading(rawHeading)

		// >> After parsing the heading, generate a slug from the heading or the custom anchor
		const slug = generateSlug({ heading, customAnchor })

		// >> Return the content, heading, and slug
		return { content: content, heading: heading, slug: slug }
	})

	// > Return the checksum, the metadata, and the sections
	return { checksum: checksum, meta: serializableMeta, sections: sections }
}

/**
 * * Abstract base class representing a source of data.
 */
export abstract class BaseSource {
	checksum?: string
	meta?: Json
	sections?: Section[]

	constructor(
		public source: string,
		public path: string,
		public parentPath?: string,
	) {}

	abstract load(): Promise<{ checksum: string; meta?: Json; sections: Section[] }>
}

/**
 * Represents a source of markdown content.
 * Extends the BaseSource class to handle markdown-specific operations.
 */
export class MarkdownSource extends BaseSource {
	type = "markdown" as const

	/**
	 * Creates an instance of MarkdownSource.
	 * @param source - The source content as a string.
	 * @param filePath - The file path to the markdown file.
	 * @param parentFilePath - The optional file path to the parent markdown file.
	 */
	constructor(
		source: string,
		public filePath: string,
		public parentFilePath?: string,
	) {
		const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
		const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")

		super(source, path, parentPath)
	}

	/**
	 * Loads the markdown content from the file, processes it for search,
	 * and sets the checksum, meta, and sections properties.
	 * @returns An object containing the checksum, meta, and sections of the markdown content.
	 */
	async load() {
		const contents = await readFile(this.filePath, "utf8")

		const { checksum, meta, sections } = processMdxForSearch(contents)

		this.checksum = checksum
		this.meta = meta
		this.sections = sections

		return { checksum: checksum, meta: meta, sections: sections }
	}
}
