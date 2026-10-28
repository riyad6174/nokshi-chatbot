export async function streamSse(
  response: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server returned an empty response.");
  const decoder = new TextDecoder();
  let buffer = "";

  const parseBlock = (block: string) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    try {
      onEvent(event, JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        parseBlock(block);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) parseBlock(buffer);
  } finally {
    reader.releaseLock();
  }
}
