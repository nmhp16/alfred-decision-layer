const LLM_TIMEOUT_MS = 30000;

interface LLMResult {
  rawOutput: string;
  timedOut: boolean;
  error: string | null;
}

export async function callLLM(prompt: string): Promise<LLMResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      rawOutput: "",
      timedOut: false,
      error: "GEMINI_API_KEY is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        rawOutput: "",
        timedOut: false,
        error: `Gemini API error ${response.status}: ${errText}`,
      };
    }

    const data = await response.json();
    const rawOutput =
      data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

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
