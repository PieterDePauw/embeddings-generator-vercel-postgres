// Import modules
import * as core from "@actions/core"
import { defineConfig } from "drizzle-kit"
// import { config } from "dotenv"

// Load environment variables
// config({ path: ".env.local" })

// Get the input values
const postgresUrl: string = core.getInput("postgres-url")

// Create a configuration object for Drizzle
export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./src/db/migrations",
	dialect: "postgresql",
	dbCredentials: { url: postgresUrl },
})
