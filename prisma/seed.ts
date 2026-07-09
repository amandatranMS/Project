/**
 * prisma/seed.ts
 *
 * The Excel workbook is the single source of truth — there are NO hardcoded
 * records here. Seeding simply runs the workbook import pipeline (reset + load).
 */
import { runImport } from '../scripts/parseWorkbook.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

runImport({ reset: true })
  .catch((err) => {
    console.error('Seed (workbook import) failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
