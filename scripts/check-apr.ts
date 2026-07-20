import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const apr = await p.approvalRequest.findFirst({
    where: { approvalRequestBusinessId: 'APR-MRTIKVTP772' },
  });
  console.log('APR-MRTIKVTP772:', JSON.stringify(apr, null, 2));

  const acts = await p.approvalRequest.findMany({
    where: { errorMessage: { contains: 'MSX_ACTION' } },
    select: {
      approvalRequestBusinessId: true,
      requestName: true,
      requestStatus: true,
      approvalStatus: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\nACTION-BACKED approvals:', JSON.stringify(acts, null, 2));

  const recent = await p.approvalRequest.findMany({
    where: { requestName: { contains: 'MS-MRTI1S4E916' } },
    select: {
      approvalRequestBusinessId: true,
      requestName: true,
      requestStatus: true,
      approvalStatus: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\nApprovals mentioning MS-MRTI1S4E916:', JSON.stringify(recent, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
