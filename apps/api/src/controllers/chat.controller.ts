import { asyncHandler, sendOk } from '../lib/responses.js';
import { chatService } from '../services/chat.service.js';
import { chatSchema } from '../validators/schemas.js';

export const chatController = {
  send: asyncHandler(async (req, res) => {
    const { messages, engine } = chatSchema.parse(req.body);
    const data = await chatService.send(messages, engine);
    sendOk(res, data);
  }),
};
