import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, Response } from "express";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function sendError(res: Response, status: number, message: string) {
  if (res.headersSent) {
    return;
  }

  res.status(status).json({ error: message });
}

function isPrismaError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientValidationError
  );
}

function isInvalidJsonError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const type = "type" in error ? error.type : undefined;
  if (type === "entity.parse.failed") {
    return true;
  }

  return error instanceof SyntaxError && "body" in error;
}

function isPayloadTooLargeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const type = "type" in error ? error.type : undefined;
  const status = "status" in error ? error.status : undefined;

  return type === "entity.too.large" || status === 413;
}

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    sendError(res, err.status, err.message);
    return;
  }

  if (isInvalidJsonError(err)) {
    sendError(res, 400, "Invalid JSON body");
    return;
  }

  if (isPayloadTooLargeError(err)) {
    sendError(res, 400, "Request body is too large");
    return;
  }

  console.error(err);
  if (isPrismaError(err)) {
    sendError(res, 500, "Internal server error");
    return;
  }

  sendError(res, 500, "Internal server error");
};
