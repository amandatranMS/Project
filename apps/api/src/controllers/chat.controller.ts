import { asyncHandler, sendOk } from '../lib/responses.js';
import { HttpError } from '../lib/httpError.js';
import { chatService } from '../services/chat.service.js';
import { chatSchema } from '../validators/schemas.js';

export const chatController = {
  send: asyncHandler(async (req, res) => {
    const { messages } = chatSchema.parse(req.body);
    const data = await chatService.send(messages, req.user);
    sendOk(res, data);
  }),

  // Streams the answer as newline-delimited JSON: {"delta":"…"} chunks, then a
  // final {"done":true} (or {"error":"…"} on failure).
  stream: asyncHandler(async (req, res) => {
    const { messages } = chatSchema.parse(req.body);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let streamed = false;
    try {
      const { reply } = await chatService.send(messages, req.user, (delta) => {
        streamed = true;
        res.write(`${JSON.stringify({ delta })}\n`);
      });
      // If nothing streamed (e.g. empty content), send the final reply once.
      if (!streamed && reply) res.write(`${JSON.stringify({ delta: reply })}\n`);
      res.write(`${JSON.stringify({ done: true })}\n`);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Something went wrong on the server.';
      res.write(`${JSON.stringify({ error: message, status })}\n`);
    } finally {
      res.end();
    }
  }),
};
