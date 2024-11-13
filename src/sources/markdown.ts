/* eslint-disable import/no-unresolved */
/* eslint-disable no-shadow */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import GithubSlugger from "github-slugger"
import { readFile } from "fs/promises"
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
 * Extracts ES literals from an `estree` `ObjectExpression`
 * into a plain JavaScript object.
 */
export function getObjectFromExpression(node: ObjectExpression) {
	// > Reduce the properties of the object expression into a plain object
	return node.properties.reduce<Record<string, string | number | bigint | true | RegExp | undefined>>((object, property) => {
		// >> Skip non-property nodes
		if (property.type !== "Property") {
			return object
		}

		// >> Extract the key and value of the property
		const key = (property.key.type === "Identifier" && property.key.name) || undefined
		const value = (property.value.type === "Literal" && property.value.value) || undefined

		// >> If the key is not a truthy value, return the object as is
		if (!key) {
			return object
		}

		// >> Return the object with the key-value pair
		return {
			...object,
			[key]: value,
		}
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
	const match = heading.match(/(.*) *\[#(.*)\]/)
	if (match) {
		const [, heading, customAnchor] = match
		return { heading: heading, customAnchor: customAnchor }
	}
	return { heading: heading }
}

/**
 * Generates a slug from a heading string or a custom anchor.
 */
export function generateSlug({ heading, customAnchor }: { heading: string; customAnchor?: string }): string {
	// > Create a new slugger instance to generate slugs
	const slugger = new GithubSlugger()
	// > Create a slug from the heading or custom anchor and return it
	return slugger.slug(customAnchor ?? heading)
}

/**
 * Processes MDX content for search indexing.
 * It extracts metadata, strips it of all JSX,
 * and splits it into sub-sections based on criteria.
 */
export function processMdxForSearch(content: string): { checksum: string; meta: Json; sections: Section[] } {
	// > Create a hash of the content to use as a checksum
	const checksum = createHash("sha256").update(content).digest("base64")

	// > Parse the MDX content into a MDX tree
	const mdxTree = fromMarkdown(content, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] })

	// > Extract metadata from the MDX tree
	const meta = extractMetaExport(mdxTree)

	// > Serialize the metadata to make it JSON serializable
	const serializableMeta: Json = meta && JSON.parse(JSON.stringify(meta))

	// > Filter out JSX nodes from the MDX tree (so we only have markdown nodes)
	const mdTree = filter(mdxTree, (node) => !["mdxjsEsm", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxFlowExpression", "mdxTextExpression"].includes(node.type))

	// > If there's no markdown tree, return an empty object
	if (!mdTree) {
		return { checksum: checksum, meta: serializableMeta, sections: [] }
	}

	// > Split the markdown tree into sections based on headings
	const sectionTrees = splitTreeBy(mdTree, (node) => node.type === "heading")

	// > Create a slugger to generate slugs for headings
	// const slugger = new GithubSlugger()

	const sections = sectionTrees.map((tree) => {
		const [firstNode] = tree.children
		const content = toMarkdown(tree)

		const rawHeading: string | undefined = firstNode.type === "heading" ? toString(firstNode) : undefined

		if (!rawHeading) {
			return { content: content }
		}

		const { heading, customAnchor } = parseHeading(rawHeading)

		// const slug = slugger.slug(customAnchor ?? heading)
		const slug = generateSlug({ heading: heading, customAnchor: customAnchor })

		return { content, heading, slug }
	})

	return { checksum: checksum, meta: serializableMeta, sections: sections }
}

export class MarkdownSource extends BaseSource {
	type = "markdown" as const

	constructor(
		source: string,
		public filePath: string,
		public parentFilePath?: string,
	) {
		const path = filePath.replace(/^pages/, "").replace(/\.mdx?$/, "")
		const parentPath = parentFilePath?.replace(/^pages/, "").replace(/\.mdx?$/, "")

		super(source, path, parentPath)
	}

	async load() {
		const contents = await readFile(this.filePath, "utf8")

		const { checksum, meta, sections } = processMdxForSearch(contents)

		this.checksum = checksum
		this.meta = meta
		this.sections = sections

		return { checksum: checksum, meta: meta, sections: sections }
	}
}
