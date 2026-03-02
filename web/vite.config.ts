import { defineConfig, loadEnv } from "vite";
import solidPlugin from "vite-plugin-solid";
import devtools from "solid-devtools/vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

type AppIconSet = {
  appleTouch: string;
  pwa64: string;
  pwa192: string;
  pwa512: string;
  maskable512: string;
};

const toIconPath = (fileName: string) => `/icons//${fileName}`;

const getAppName = (mode: string): string => {
  if (mode === "development") return "MFAG Hub (Dev)";
  if (mode === "staging") return "MFAG Hub (Test)";
  return "MFAG Hub";
};

const getAppIconSet = (mode: string): AppIconSet => {
  const prefix =
    mode === "development" ? "dev-" : mode === "staging" ? "test-" : "";

  return {
    appleTouch: toIconPath(`${prefix}apple-touch-icon-180x180.png`),
    pwa64: toIconPath(`${prefix}pwa-64x64.png`),
    pwa192: toIconPath(`${prefix}pwa-192x192.png`),
    pwa512: toIconPath(`${prefix}pwa-512x512.png`),
    maskable512: toIconPath(`${prefix}maskable-icon-512x512.png`),
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET || env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
  const appName = getAppName(mode);
  const appIcons = getAppIconSet(mode);

  return {
    plugins: [
      tailwindcss(),
      devtools(),
      solidPlugin(),
      {
        name: "env-app-shell",
        transformIndexHtml(html) {
          return html
            .replaceAll("MFAG Hub", appName)
            .replaceAll("/icons//pwa-64x64.png", appIcons.pwa64)
            .replaceAll("/icons//apple-touch-icon-180x180.png", appIcons.appleTouch);
        },
      },
      VitePWA({
        registerType: "prompt",
        devOptions: {
          enabled: true,
        },
        workbox: {
          importScripts: ["push-handlers.js"],
        },
        includeAssets: [
          "/images/*.{png,webp}",
          "/images/install/*",
          appIcons.pwa64,
          appIcons.appleTouch,
        ],
        manifest: {
          id: "/",
          name: appName,
          short_name: appName,
          description: appName,
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ffffff",
          theme_color: "#178e9e",
          icons: [
            {
              src: appIcons.pwa64,
              sizes: "64x64",
              type: "image/png",
            },
            {
              src: appIcons.pwa192,
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: appIcons.pwa512,
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: appIcons.maskable512,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
            {
              src: "/icons//notification-badge-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "monochrome",
            },
          ],
        },
      }),
    ],
    server: {
      port: 3000,
      allowedHosts: ["uninvestigating-unresiliently-sade.ngrok-free.dev", "192.168.1.10"],
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/sanctum": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      target: "esnext",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("quill")) return "quill";
            if (id.includes("jspdf") || id.includes("html2canvas"))
              return "reports";
            if (id.includes("solid-icons")) return "icons";
            if (id.includes("@solidjs")) return "solid-router";
            if (id.includes("solid-js")) return "solid";
            return;
          },
        },
      },
    },
  };
});
