// Import modules
import { readdir, stat } from "fs/promises"
import { basename, dirname, join } from "path"

// Function to walk a directory and return all files
export async function walk(dir: string, parentPath?: string): Promise<{ path: string; parentPath?: string }[]> {
	// > Read the contents of the directory
	const immediateFiles = await readdir(dir)

	// > Recursively walk the directory and return all files in the directory and subdirectories
	const recursiveFiles = await Promise.all(
		// >> For each file in the directory, ...
		immediateFiles.map(async (file) => {
			// >>> Construct the full path to the file
			const path = join(dir, file)
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

	// > Return the flattened array of files sorted by path name
	return recursiveFiles.reduce((all, folderContents) => all.concat(folderContents), []).sort((a, b) => a.path.localeCompare(b.path))
}
