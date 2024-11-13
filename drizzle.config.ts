// Import modules
import { config } from "dotenv"
import { defineConfig } from "drizzle-kit"

// Load environment variables
config({ path: ".env.local" })

// Check if the POSTGRES_URL environment variable is set
if (!process.env.POSTGRES_URL) {
	throw new Error("The environment variable POSTGRES_URL has not yet been set")
}

// Create a configuration object for Drizzle
export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	dialect: "postgresql",
	dbCredentials: { url: process.env.POSTGRES_URL },
})
