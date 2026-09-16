import "./env.js";
import cors from "cors";
import express from "express";
import { errorMiddleware } from "./errors.js";
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

if (isTrustProxyEnabled()) {
  // Only enable when the API sits behind a reverse proxy so client IPs
  // are taken from X-Forwarded-For. Leaving this off locally avoids spoofing.
  app.set("trust proxy", 1);
}

// The API is authenticated with per-request bearer tokens (Neon Auth JWTs),
// not cookies, so it's safe to allow any origin here.
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/urls", urlsRouter);

app.get("/:shortCode", redirectHardLimiter, redirectClickLimiter, redirectToOriginalUrl);

app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  console.log(
    `Redirect limits: ${redirectClickMax} recorded clicks / IP / ${redirectWindowMs}ms (soft), ${redirectHardMax} requests (hard)`,
  );
});
