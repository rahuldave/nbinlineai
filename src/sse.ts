export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

/** Parses SSE data frames across arbitrary network chunk boundaries. */
export class SSEParser {
  private buffer = '';
  push(chunk: string): StreamEvent[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, '\n');
    const events: StreamEvent[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') {
        const parsed = JSON.parse(data) as StreamEvent;
        if (parsed && typeof parsed.type === 'string') events.push(parsed);
      }
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }
}

export async function readEventStream(response: Response, onEvent: (event: StreamEvent) => void): Promise<void> {
  if (!response.body) throw new Error('The server returned no response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
    for (const event of parser.push(decoder.decode() + '\n\n')) onEvent(event);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
