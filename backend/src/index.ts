import "./env.js";
import cors from "cors";
import express from "express";
import { errorMiddleware, sendError } from "./errors.js";
import { prisma } from "./prisma.js";
import { redirectToOriginalUrl } from "./redirect.js";
import {
  isTrustProxyEnabled,
  redirectClickLimiter,
  redirectClickMax,
  redirectHardLimiter,
  redirectHardMax,
  redirectWindowMs,
} from "./rate-limit.js";
import { urlsRouter } from "./urls.router.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");

if (isTrustProxyEnabled()) {
  // Only enable when the API sits behind a reverse proxy so client IPs
  // are taken from X-Forwarded-For. Leaving this off locally avoids spoofing.
  app.set("trust proxy", 1);
}

// The API is authenticated with per-request bearer tokens (Neon Auth JWTs),
// not cookies, so it's safe to allow any origin here.
app.use(cors({ maxAge: 86_400 }));
app.use((_req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  next();
});
app.use(express.json({ limit: "16kb" }));

/** Liveness: the process is up. Cheap enough for frequent platform probes. */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/** Readiness: the process can reach the database. */
app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "degraded", database: "unreachable" });
  }
});

app.use("/api/urls", urlsRouter);
app.use("/api", (_req, res) => {
  sendError(res, 404, "Not found");
});

app.get("/:shortCode", redirectHardLimiter, redirectClickLimiter, redirectToOriginalUrl);

app.use(errorMiddleware);

const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(
    `Redirect limits: ${redirectClickMax} recorded clicks / IP / ${redirectWindowMs}ms (soft), ${redirectHardMax} requests (hard)`,
  );
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received, draining connections…`);

  // Hosts like Render send SIGTERM before replacing an instance; finish
  // in-flight requests, then release DB connections.
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
