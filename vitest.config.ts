import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // Fixed values so tests never depend on a developer's .env.local or CI secrets.
    env: {
      VITE_SUPABASE_URL: "https://project.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      VITE_ALLOW_FREE_SYNC: "false"
    }
  }
});
