/* eslint-disable import/no-unresolved */
/* eslint-disable no-shadow */
/* eslint-disable no-console */
/* eslint-disable object-shorthand */

// Import modules
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import GithubSlugger from "github-slugger"
import { ObjectExpression } from "estree"
import { Content, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { mdxFromMarkdown, type MdxjsEsm } from "mdast-util-mdx"
import { toMarkdown } from "mdast-util-to-markdown"
import { toString } from "mdast-util-to-string"
import { mdxjs } from "micromark-extension-mdxjs"
import { u } from "unist-builder"
import { filter } from "unist-util-filter"
import { type Json, type Section, type MarkdownSourceType, type FileType } from "./types"

// Define the slugger to ensure the uniqueness of each slug
const slugger = new GithubSlugger()

/**
 * Walks a directory recursively to gather all files.
 */
export async function walk(directory: string, parentPath?: string): Promise<FileType[]> {
	const immediateFiles = await fs.readdir(directory)
	const recursiveFiles = await Promise.all(
		immediateFiles.map(async (file) => {
			const fullPath = path.join(directory, file)
			const fileStats = await fs.stat(fullPath)

			if (fileStats.isDirectory()) {
				const docPath = `${path.basename(fullPath)}.mdx`
				const nextParentPath = immediateFiles.includes(docPath) ? path.join(path.dirname(fullPath), docPath) : parentPath
				return walk(fullPath, nextParentPath)
			}

			if (fileStats.isFile()) {
				return [{ path: fullPath, parentPath: parentPath }]
			}

			return []
		}),
	)
	console.log(`Processed ${recursiveFiles.length} items in directory: ${directory}`)
	return recursiveFiles.flat().sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Extracts an object from an ESTree ObjectExpression node.
 */
export function getObjectFromExpression(node: ObjectExpression): Json {
	return node.properties.reduce<Json>((obj, property) => {
		if (property.type === "Property" && property.key.type === "Identifier" && property.value.type === "Literal") {
			obj[property.key.name] = property.value.value as string | number | boolean | null
		}
		return obj
	}, {})
}

/**
 * Extracts metadata from the MDX file's `meta` ESM export.
 */
export function extractMetaExport(mdxTree: Root): Json | undefined {
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

/**
 * Splits an mdast tree into sections based on a predicate.
 */
export function splitTreeBy(tree: Root, predicate: (node: Content) => boolean): Root[] {
	return tree.children.reduce<Root[]>((sections, node) => {
		const lastSection = sections.at(-1)
		if (!lastSection || predicate(node)) {
			sections.push(u("root", [node]))
		} else {
			lastSection.children.push(node)
		}
		return sections
	}, [])
}

/**
 * Parses a markdown heading with optional custom anchor.
 */
export function parseHeading(heading: string): { heading: string; customAnchor?: string } {
	const match = heading.match(/(.*) *\[#(.*)\]/)
	if (match && match[1] && match[2]) return { heading: match[1], customAnchor: match[2] }
	if (match && match[1]) return { heading: match[1] }
	return { heading: heading }
}

/**
 * Processes and returns an array of sections from an mdast tree.
 */
export function processSections(mdTree: Root): Section[] {
	return splitTreeBy(mdTree, (node) => node.type === "heading").map((sectionTree) => {
		const [firstNode] = sectionTree.children
		if (!firstNode || firstNode.type !== "heading") return { "content": toMarkdown(sectionTree), "heading": "", "slug": "" }
		const { heading, customAnchor } = parseHeading(toString(firstNode))
		return { "content": toMarkdown(sectionTree), "heading": heading, "slug": slugger.slug(customAnchor ?? heading) }
	})
}

/**
 * Generates sources from markdown files in a directory.
 */
export async function generateMarkdownSources({ docsRootPath, ignoredFiles = ["pages/404.mdx"] }: { docsRootPath: string; ignoredFiles: string[] }): Promise<MarkdownSourceType[]> {
	const files: FileType[] = await walk(docsRootPath)
	const markdownFiles: FileType[] = files.filter(({ path }) => /\.mdx?$/.test(path) && !ignoredFiles.includes(path))
	const sources: MarkdownSourceType[] = await Promise.all(
		markdownFiles.map(async ({ path, parentPath }) => {
			const content = await fs.readFile(path, "utf8")
			const checksum = crypto.createHash("sha256").update(content).digest("base64")
			const mdxTree = fromMarkdown(content, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] })
			const meta = extractMetaExport(mdxTree) || {}
			const mdTree = filter(mdxTree, (node) => !["mdxjsEsm", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxFlowExpression", "mdxTextExpression"].includes(node.type))
			if (!mdTree) return { content, path, checksum, meta, parentPath, sections: [] }
			const sections = processSections(mdTree)
			return { content, path, checksum, meta, parentPath, sections }
		}),
	)
	console.log(`Discovered ${sources.length} pages`)
	return sources
}
