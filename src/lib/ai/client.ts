import "server-only";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// Claude client for the extraction layer. The model only ever proposes
// structured candidates with verbatim source quotes; every portfolio number is
// computed deterministically in src/lib/portfolio.ts, and every extracted row
// stays editable (see the provenance contract in prisma/schema.prisma).

const MODEL = process.env.AI_MODEL ?? "claude-opus-5";

/// Credentials resolve the way the SDK resolves them, first match winning:
/// ANTHROPIC_API_KEY, then ANTHROPIC_AUTH_TOKEN, then an `ant auth login`
/// profile on disk. The profile path only exists on a developer machine, so a
/// deployment still needs a key; locally it means no key has to be stored.
function oauthProfileAvailable(): boolean {
  const configDir =
    process.env.ANTHROPIC_CONFIG_DIR ?? path.join(homedir(), ".config", "anthropic");
  return existsSync(path.join(configDir, "credentials"));
}

export function aiConfigured(): boolean {
  return (
    !!process.env.ANTHROPIC_API_KEY ||
    !!process.env.ANTHROPIC_AUTH_TOKEN ||
    oauthProfileAvailable()
  );
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "Claude is not configured. Set ANTHROPIC_API_KEY, or run `ant auth login` " +
        "for local development (with ANTHROPIC_API_KEY unset, or the key wins).",
    );
    this.name = "AiNotConfiguredError";
  }
}

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  // Constructed with no arguments on purpose: that is what lets the SDK fall
  // through to the OAuth profile when no key is set.
  client ??= new Anthropic();
  return client;
}

interface ExtractOptions {
  /// Extraction is a bounded reading task, so it does not need the default
  /// effort. Raise this per-call if a prompt turns out to need more.
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  signal?: AbortSignal;
}

/// One structured-output call: prompt in, schema-validated object out. Throws
/// AiNotConfiguredError with no key, or Error if the model declined or the
/// response failed to parse against the schema.
export async function extractStructured<T extends z.ZodType>(
  system: string,
  user: string,
  schema: T,
  opts: ExtractOptions = {},
): Promise<z.infer<T>> {
  const response = await getClient().messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: opts.effort ?? "medium",
      format: zodOutputFormat(schema),
    },
    system,
    messages: [{ role: "user", content: user }],
  }, { signal: opts.signal });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Claude declined to process this email (${response.stop_details?.category ?? "unknown"}).`,
    );
  }
  if (!response.parsed_output) {
    throw new Error("Extraction returned no schema-valid output.");
  }
  return response.parsed_output as z.infer<T>;
}
