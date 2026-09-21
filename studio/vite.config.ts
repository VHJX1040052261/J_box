import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@policy": fileURLToPath(new URL("../policy.mjs", import.meta.url)),
      "@engine": fileURLToPath(new URL("../tetris.mjs", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // 策略模块住在上一级目录，与 Node 脚本共用同一份判定逻辑，不允许复制第二份
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
