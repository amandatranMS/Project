/**
 * Seed the database from the workbook ONLY when it's empty. This lets the
 * container reseed a fresh volume on first boot while preserving any runtime
 * data across subsequent restarts (unlike the unconditional import).
 */
import { PrismaClient } from '@prisma/client';
import { runImport } from './parseWorkbook.js';

async function main() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.opportunity.count();
    if (count === 0) {
      console.log('[ensureSeed] Database is empty — importing workbook...');
      await runImport({ reset: true });
      console.log('[ensureSeed] Import complete.');
    } else {
      console.log(`[ensureSeed] Database already has ${count} opportunities — skipping seed.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[ensureSeed] Failed:', err);
  process.exit(1);
});
