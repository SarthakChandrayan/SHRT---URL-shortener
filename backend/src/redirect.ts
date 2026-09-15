import type { NextFunction, Request, Response } from "express";
import { sendError } from "./errors.js";
import { prisma } from "./prisma.js";

export async function redirectToOriginalUrl(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const shortCode = req.params.shortCode;

    if (typeof shortCode !== "string" || shortCode.trim() === "") {
      sendError(res, 404, "Short URL not found");
      return;
    }

    const url = await prisma.url.findUnique({
      where: { shortCode },
    });

    if (!url) {
      sendError(res, 404, "Short URL not found");
      return;
    }

    if (url.expiresAt && url.expiresAt.getTime() <= Date.now()) {
      sendError(res, 410, "This short URL has expired");
      return;
    }

    await prisma.click.create({
      data: {
        urlId: url.id,
      },
    });

    res.redirect(302, url.originalUrl);
  } catch (error) {
    next(error);
  }
}
