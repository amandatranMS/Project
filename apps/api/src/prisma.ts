import { PrismaClient } from '@prisma/client';

/** Singleton Prisma client shared across the API. */
export const prisma = new PrismaClient();
