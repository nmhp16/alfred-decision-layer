const LLM_TIMEOUT_MS = 30000;

interface LLMResult {
  rawOutput: string;
  timedOut: boolean;
  error: string | null;
}

export async function callLLM(prompt: string): Promise<LLMResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      rawOutput: "",
      timedOut: false,
      error: "GROQ_API_KEY is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are alfred_'s execution decision layer. Respond with valid JSON only, no markdown fences.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      let errorMsg = `Groq API error ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        const message = errJson?.error?.message;
        if (message) {
          errorMsg = `Groq API error ${response.status}: ${message.split("\n")[0]}`;
        }
      } catch {
        if (errText.length > 200) {
          errorMsg += `: ${errText.slice(0, 200)}...`;
        } else if (errText) {
          errorMsg += `: ${errText}`;
        }
      }
      return {
        rawOutput: "",
        timedOut: false,
        error: errorMsg,
      };
    }

    const data = await response.json();
    const rawOutput = data.choices?.[0]?.message?.content ?? "";

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
