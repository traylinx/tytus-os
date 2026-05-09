export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface OpenAiChatChoice {
  message?: { content?: string };
  delta?: { content?: string };
}

export interface OpenAiChatResponse {
  choices?: OpenAiChatChoice[];
  error?: { message?: string } | string;
}

const decoder = new TextDecoder();

export async function* parseOpenAiSse(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const parsed = JSON.parse(data) as OpenAiChatResponse;
        const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
        if (token) yield token;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const extractChatText = (json: OpenAiChatResponse): string => {
  const err = json.error;
  if (typeof err === 'string') throw new Error(err);
  if (err?.message) throw new Error(err.message);
  return json.choices?.[0]?.message?.content ?? json.choices?.[0]?.delta?.content ?? '';
};
