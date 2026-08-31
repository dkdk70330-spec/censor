import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/censor/",
  plugins: [react()],
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm"] },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"]
});
