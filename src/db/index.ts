// Import modules
import { config } from "dotenv"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

// Load environment variables
config({ path: ".env.local" }) // or .env

// Create a Drizzle client
// You can specify any property from the node - postgres connection options
export const db = drizzle({ connection: { connectionString: process.env.DATABASE_URL, ssl: true } })
