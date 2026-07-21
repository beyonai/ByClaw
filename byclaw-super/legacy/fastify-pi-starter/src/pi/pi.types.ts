export interface ChatInput {
  message: string;
  systemPrompt?: string;
}

export interface ChatResult {
  sessionId: string;
  model: string;
  text: string;
}

export type StreamEvent =
  | { type: "start"; sessionId: string; model: string }
  | { type: "delta"; text: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string; isError: boolean }
  | { type: "done" }
  | { type: "error"; message: string };

export interface PiClient {
  chat(input: ChatInput): Promise<ChatResult>;
  stream(input: ChatInput, emit: (event: StreamEvent) => void): Promise<void>;
  isReady(): boolean;
}
