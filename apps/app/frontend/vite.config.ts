import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// Builds into apps/app/public - the directory infra/main.tf's
// cloudflare_workers_script points at for its static assets. Run this
// (pnpm --filter poit-app build:frontend) before `terraform apply`.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
