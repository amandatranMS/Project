/** Shared chat types used by the assistant path. */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Receives each text delta of the answer as it streams, for live "typing" in the
 * UI. Omitted when the caller wants the reply in one piece.
 */
export type TokenSink = (delta: string) => void;
