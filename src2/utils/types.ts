export type Json = Record<string, string | number | boolean | null | Json[] | { [key: string]: Json }>
export type Section = { content: string; heading: string; slug: string }
export type MarkdownSourceType = { content: string; path: string; checksum: string; meta?: Json; parentPath: string | undefined; sections: Section[] }
export type EmbeddingModel = { "name": string; "dimensions": number; "pricing": number; "maxRetries": number }
export type FileType = { path: string; parentPath?: string }
