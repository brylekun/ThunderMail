import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './worker/migrations',
  schema: './db/schema.ts',
  dialect: 'sqlite',
});
