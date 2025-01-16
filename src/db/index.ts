// Import modules
import dotenv from "dotenv"
import { drizzle } from "drizzle-orm/node-postgres"
import * as schema from "./schema"

// Load environment variables from .env.local and .env files (.env will override .env.local)
dotenv.config({ path: [".env.local", ".env"], override: true })

// Create a Drizzle client
// You can specify any property from the node - postgres connection options
export const db = drizzle({ connection: { connectionString: process.env.DATABASE_URL, ssl: true }, schema: schema })
