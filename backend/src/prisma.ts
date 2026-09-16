import "./env.js";
import { PrismaClient } from "@prisma/client";

function datasourceUrl() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("pgbouncer")) {
      parsed.searchParams.set("pgbouncer", "true");
    }
    return parsed.href;
  } catch {
    return url;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: datasourceUrl(),
  });

globalForPrisma.prisma = prisma;
