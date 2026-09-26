import OpenAI from "openai";

/** Shared OpenAI client, retry policy and JSON helper for all AI features. */

let openaiClient: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new ProcessingError("The transcription service is not configured (missing OPENAI_API_KEY).");
  }
  if (!openaiClient) {
    // The SDK retries 408/409/429/5xx and connection errors with exponential backoff
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 4,
      timeout: 5 * 60 * 1000,
    });
  }
  return openaiClient;
}

/** An error whose message is safe and useful to show to the user. */
export class ProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessingError";
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof OpenAI.APIConnectionError) return true; // includes timeouts
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    if (status === 429) return !/quota/i.test(err.message);
    return status === 408 || status === 409 || status >= 500;
  }
  return false;
}

export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1 || !isRetryable(err)) throw err;
      const delay = Math.round(Math.min(1000 * 2 ** i, 20_000) * (0.75 + Math.random() * 0.5));
      console.warn(`[retry] ${label} failed (${(err as Error).message}); attempt ${i + 2}/${attempts} in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export async function chatJSON(system: string, user: string, opts: { model?: string } = {}): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await getOpenAI().chat.completions.create({
      model: opts.model ?? "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = response.choices[0]?.message?.content;
    try {
      if (!content) throw new Error("empty response");
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object") return parsed;
      throw new Error("response was not an object");
    } catch (err) {
      lastError = err;
      console.warn(`[analyze] invalid JSON from model (attempt ${attempt + 1}):`, (err as Error).message);
    }
  }
  throw new ProcessingError(`Analysis returned an unreadable result (${(lastError as Error)?.message}). Please retry.`);
}
