import { PrismaClient, type Prisma } from "@prisma/client";

/** Client ou transaction interactive. */
export type Db = Prisma.TransactionClient;

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = prisma;
