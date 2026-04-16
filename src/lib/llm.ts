import Anthropic from "@anthropic-ai/sdk";

const LLM_TIMEOUT_MS = 15000;

interface LLMResult {
  rawOutput: string;
  timedOut: boolean;
  error: string | null;
}

export async function callLLM(prompt: string): Promise<LLMResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      rawOutput: "",
      timedOut: false,
      error: "ANTHROPIC_API_KEY is not configured",
    };
  }

  const client = new Anthropic({ apiKey });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await client.messages.create(
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const textBlock = response.content.find((b) => b.type === "text");
    const rawOutput = textBlock?.text ?? "";

    return { rawOutput, timedOut: false, error: null };
  } catch (err: unknown) {
    clearTimeout(timeout);

    if (err instanceof Error && err.name === "AbortError") {
      return { rawOutput: "", timedOut: true, error: "LLM request timed out" };
    }

    const message = err instanceof Error ? err.message : "Unknown LLM error";
    return { rawOutput: "", timedOut: false, error: message };
  }
}
