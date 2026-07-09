import 'dotenv/config';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`MSX Milestone Assistant API (mock) listening on http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/api/health`);
});
