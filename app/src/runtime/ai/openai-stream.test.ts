import { describe, expect, it } from 'vitest';
import { parseOpenAiSse } from './openai-stream';

const streamFrom = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });

describe('parseOpenAiSse', () => {
  it('yields token deltas from OpenAI-style streaming chunks', async () => {
    const chunks: string[] = [];
    for await (const token of parseOpenAiSse(streamFrom([
      'data: {"choices":[{"delta":{"content":"he"}}]}',
      'data: {"choices":[{"delta":{"content":"llo"}}]}',
      'data: [DONE]',
      '',
    ].join('\n')))) {
      chunks.push(token);
    }

    expect(chunks.join('')).toBe('hello');
  });

  it('yields full message content from AIL gateways that wrap completed chat responses in SSE', async () => {
    const chunks: string[] = [];
    for await (const token of parseOpenAiSse(streamFrom([
      'data: {"choices":[{"message":{"role":"assistant","content":"remote ok"}}]}',
      'data: [DONE]',
      '',
    ].join('\n')))) {
      chunks.push(token);
    }

    expect(chunks).toEqual(['remote ok']);
  });
});
