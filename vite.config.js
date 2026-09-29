import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import fs from "node:fs";

// =========================================================
// TEMPORARY DIAGNOSTIC LOGGER — remove after debugging
// =========================================================
//
// Captures the raw, real incoming request (method, url,
// headers) and the outgoing response (status, truncated body)
// for /api/goal* and /app/goal-products, BEFORE React Router's
// own request handling (including its CSRF check) runs — since
// that check can reject a request before any application
// loader/action code executes, logging only inside route files
// would miss a rejected request entirely.
//
// Writes to a local scratch file, never to Git, never logs
// cookies/authorization header values (only whether they were
// present).
// =========================================================

const DEBUG_LOG_PATH =
  "C:/Users/KRUSHA~1.APP/AppData/Local/Temp/claude/c--Users-krushapatel-APPSERVER-ai-shopify-search/3d916545-fe71-44e6-9cb0-313c8bde2f2e/scratchpad/goal-request-debug.log";

function safeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "cookie" || lower === "authorization") {
      out[key] = value ? "<present>" : "<absent>";
    } else {
      out[key] = value;
    }
  }
  return out;
}

function requestDebugLoggerPlugin() {
  return {
    name: "request-debug-logger",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/goal") && !url.startsWith("/app/goal-products")) {
          return next();
        }

        const startedAt = new Date().toISOString();
        const entry = {
          time: startedAt,
          method: req.method,
          url,
          headers: safeHeaders(req.headers)
        };

        const chunks = [];
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);

        res.write = (chunk, ...args) => {
          if (chunk) chunks.push(Buffer.from(chunk));
          return originalWrite(chunk, ...args);
        };

        res.end = (chunk, ...args) => {
          if (chunk) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks).toString("utf8").slice(0, 1000);
          entry.responseStatus = res.statusCode;
          entry.responseBody = body;
          try {
            fs.appendFileSync(DEBUG_LOG_PATH, JSON.stringify(entry) + "\n");
          } catch (e) {
            // Never let logging break the real request.
          }
          return originalEnd(chunk, ...args);
        };

        next();
      });
    }
  };
}

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the Vite server.
// The CLI will eventually stop passing in HOST,
// so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;
let hmrConfig;

if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules"],
    },
  },
  plugins: [requestDebugLoggerPlugin(), reactRouter(), tsconfigPaths()],
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    include: ["@shopify/app-bridge-react"],
  },
});
