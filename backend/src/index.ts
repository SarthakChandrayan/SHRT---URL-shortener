import "dotenv/config";
import express from "express";
import { errorMiddleware } from "./errors.js";
import { redirectToOriginalUrl } from "./redirect.js";
import { urlsRouter } from "./urls.router.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/urls", urlsRouter);

app.get("/:shortCode", redirectToOriginalUrl);

app.use(errorMiddleware);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
