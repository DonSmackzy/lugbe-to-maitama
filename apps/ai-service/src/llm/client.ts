// =============================================================================
// LLM Client Wrapper with AbortController 1500ms SLA & Safe Fallback
// Guarantees zero unhandled crashes and strict sub-1500ms resolution.
// =============================================================================

import OpenAI from "openai";
import { config } from "../config.js";
import { buildSystemPrompt, sanitizeStats, type BucketedStats } from "./prompts.js";

let _openai: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!config.openaiApiKey) return null;
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
      timeout: config.llmTimeoutMs,
    });
  }
  return _openai;
}

export type DialogueGenerationResult = {
  text: string;
  fromCache: boolean;
  fallback: boolean;
};

/**
 * Removes emojis and control symbols to enforce strict text persona constraint.
 */
export function stripEmojis(str: string): string {
  return str
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Invokes LLM with strict 1500ms AbortController timeout.
 * On ANY error (timeout, rate limit, network abort), cleanly returns fallbackLine.
 */
export async function generateDialogue(
  archetypeId: string,
  rawStats: unknown,
  fallbackLine: string,
  zoneType = "commercial",
  overrideTimeoutMs?: number
): Promise<DialogueGenerationResult> {
  const client = getOpenAIClient();
  const safeFallback = fallbackLine || "Oga, we dey move.";

  if (!client) {
    return { text: safeFallback, fromCache: false, fallback: true };
  }

  const timeoutMs = overrideTimeoutMs ?? config.llmTimeoutMs;
  const controller = new AbortController();
  let timerId: NodeJS.Timeout | undefined;

  try {
    const systemPrompt = buildSystemPrompt(archetypeId, sanitizeStats(rawStats), zoneType);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        controller.abort();
        const err = new Error("LLM_TIMEOUT");
        err.name = "TimeoutError";
        reject(err);
      }, timeoutMs);
    });

    const completionPromise = client.chat.completions.create(
      {
        model: config.openaiModel,
        max_tokens: 80,
        temperature: 0.85,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Speak directly to this citizen in 1 or 2 short sentences." },
        ],
      },
      { signal: controller.signal }
    );

    const response = await Promise.race([completionPromise, timeoutPromise]);
    if (timerId) clearTimeout(timerId);

    const rawText = response.choices[0]?.message?.content?.trim() ?? "";
    const cleanedText = stripEmojis(rawText);

    // Enforce 280-character maximum length constraint
    const truncatedText = cleanedText.length > 280 ? cleanedText.slice(0, 277) + "..." : cleanedText;

    if (!truncatedText) {
      return { text: safeFallback, fromCache: false, fallback: true };
    }

    return { text: truncatedText, fromCache: false, fallback: false };
  } catch (err: unknown) {
    if (timerId) clearTimeout(timerId);
    const errorObj = err as Error;

    // Log diagnostic warning without crashing the process
    console.warn(`[ai-service] LLM dialogue generation failed (${errorObj.name}: ${errorObj.message}). Using fallback.`);

    return { text: safeFallback, fromCache: false, fallback: true };
  }
}
