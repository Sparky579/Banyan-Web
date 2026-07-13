import { defineConfig } from "vite";

export default defineConfig({
  server: { allowedHosts: ["banyan.sparky.qzz.io"] },
  preview: { allowedHosts: ["banyan.sparky.qzz.io"] }
});
