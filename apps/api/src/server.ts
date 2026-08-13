import 'dotenv/config';
import { createApp } from './app.js';
import { startCommitmentSweep } from './services/milestoneCommitment.service.js';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Multi-Agent Sales Assistant API (mock) listening on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
  // System time-rule: commit any milestone whose target date has passed while it
  // was still Uncommitted. Runs now and on an interval thereafter.
  startCommitmentSweep();
});
