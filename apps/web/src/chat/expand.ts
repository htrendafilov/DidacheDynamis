// M9.4 step 1: question -> validated English terms. Retrieval and the staged UI
// turn are later steps; this module does not search or alter conversation state.
import { streamChat, type ChatModel, type ChatUsage } from "./client";
import { ChatError } from "./errors";
import { buildExpansionMessages } from "./prompt";

export interface ExpansionResult {
  terms: string[];
  usage?: ChatUsage;
  actualModel?: string; // retain the router's choice for the later turn/history layer
}

function expansionFailed(): ChatError {
  // Never retain the question, raw model output, or provider error in an error message.
  return new ChatError("expansionFailed", "The model did not return usable search terms.");
}

export function parseExpansionTerms(output: string): string[] {
  const text = output.trim();
  // Unwrap one complete fence only. Nested fences or surrounding prose still fail JSON.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  let value: unknown;
  try {
    value = JSON.parse(fence ? fence[1] : text);
  } catch {
    throw expansionFailed();
  }
  if (!Array.isArray(value) || value.length < 2 || value.length > 5) throw expansionFailed();

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") throw expansionFailed();
    const term = entry.trim();
    if (term.length < 2 || term.length > 40 || !/^[a-z0-9 '-]+$/i.test(term) || !/[a-z0-9]/i.test(term)) {
      throw expansionFailed();
    }
    // ASCII English terms make lowercase equivalent to casefold. Keep the first spelling.
    // Apostrophes and hyphens deliberately remain: FTS splits them at index/query time.
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
  }
  if (terms.length < 2) throw expansionFailed();
  return terms;
}

export async function expandQuestion(
  question: string,
  model: ChatModel,
  privacyRouting: boolean,
  signal: AbortSignal,
  uiLang: "en" | "bg" = "en",
): Promise<ExpansionResult> {
  let output = "";
  try {
    // The user's question travels through the same privacy route as an answer.
    // No source text is sent here, so the ai_context_policy licence gate does not apply.
    const meta = await streamChat(
      {
        providerId: "openrouter",
        model: model.id,
        messages: buildExpansionMessages(question, uiLang),
        maxTokens: 200,
        maxRetries: 0,
        privacyRouting,
        reasoningCaps: model.reasoning,
        signal,
      },
      {
        onDelta: (delta) => { output += delta; },
        onMeta: () => {},
      },
    );
    // streamChat intentionally resolves on cancellation to keep partial answers. Terms
    // have no partial-result semantics: check abort before parsing a truncated response.
    if (signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
    return {
      terms: parseExpansionTerms(output),
      usage: meta.usage ?? undefined,
      actualModel: meta.actualModel ?? undefined,
    };
  } catch (err) {
    if (signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
    if (err instanceof ChatError && ["aborted", "auth", "credit", "privacyConstraint"].includes(err.kind)) {
      throw err;
    }
    throw expansionFailed();
  }
}
