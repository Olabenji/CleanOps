import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  envPrefix: ["VITE_", "EXPO_PUBLIC_"],
  plugins: [react()],
  server: {
    port: 5173
  }
});
