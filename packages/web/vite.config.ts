import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/oc": "http://127.0.0.1:4100",
      "/api": "http://127.0.0.1:4100",
    },
  },
});
