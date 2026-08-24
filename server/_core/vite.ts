import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // ── HTTP-layer caching (stale-while-revalidate strategy) ──
  // Vite fingerprints files in assets/ with a content hash, so they are safe
  // to cache forever — a deploy produces new URLs instead of new content.
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "365d",
    }),
  );

  // Other static files (icons, manifest, sw.js): serve from browser cache for
  // an hour, then keep serving stale while revalidating in the background.
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders(res) {
        res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      },
    }),
  );

  // fall through to index.html if the file doesn't exist.
  // HTML must always revalidate so a new deploy rolls out immediately
  // (it references freshly hashed /assets/* URLs).
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
