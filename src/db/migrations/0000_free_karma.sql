-- Custom SQL migration file, put you code below! --

-- Enable the extension "pg-vector" to use the vector data type
CREATE EXTENSION IF NOT EXISTS vector;

-- Output a message to the console to indicate that the migration was successful --
DO $$ BEGIN RAISE NOTICE 'Extension "pg-vector" enabled!'; END $$;
