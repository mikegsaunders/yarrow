import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ───────────────────────────────────────────────
// Auth loading
// ───────────────────────────────────────────────

function loadAuthJson(): Record<string, { type: string; key: string }> {
  try {
    const paths = [
      resolve(homedir(), ".pi/agent/auth.json"),
      resolve(homedir(), ".local/share/pi/auth.json"),
    ];
    for (const path of paths) {
      try {
        const raw = readFileSync(path, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        continue;
      }
    }
  } catch {
    // ignore
  }
  return {};
}

const AUTH = loadAuthJson();
const getKey = (name: string): string | undefined =>
  process.env[name] || AUTH[name]?.key;

// ───────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────

interface WebSearchInput {
  query: string;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  country?: string;
  freshness?: "day" | "week" | "month" | "year";
  provider?: "exa" | "brave" | "openrouter";
}

interface WebSearchResultItem {
  url: string;
  title: string;
  excerpt: string;
  publishedDate?: string;
}

interface WebSearchResponse {
  results: WebSearchResultItem[];
  provider: "exa" | "brave" | "openrouter";
  summary?: string;
  costUsd?: number;
}

interface UsageState {
  exaThisMonth: number;
  braveThisMonth: number;
  month: string; // YYYY-MM
}

// ───────────────────────────────────────────────
// Config & constants
// ───────────────────────────────────────────────

const EXA_API_KEY = getKey("EXA_API_KEY") || getKey("exa-search");
const BRAVE_API_KEY = getKey("BRAVE_API_KEY") || getKey("brave-search");
const OPENROUTER_API_KEY = getKey("OPENROUTER_API_KEY") || getKey("openrouter");
const OPENROUTER_MODEL =
  process.env.OPENROUTER_SEARCH_MODEL ?? "openai/gpt-4o-mini";

const EXA_FREE_TIER = 1_000;
const EXA_SAFETY_MARGIN = 950;
const BRAVE_FREE_TIER = 1_000;
const BRAVE_SAFETY_MARGIN = 950;
const BRAVE_MIN_INTERVAL_MS = 1_100;

const FETCH_TIMEOUT_MS = 15_000;
const OPENROUTER_TIMEOUT_MS = 30_000;

// ───────────────────────────────────────────────
// Mutable process-level state
// ───────────────────────────────────────────────

let usage: UsageState = {
  exaThisMonth: 0,
  braveThisMonth: 0,
  month: getCurrentMonth(),
};

let exaPermanentlyFailed = false;
let bravePermanentlyFailed = false;
let openRouterPermanentlyFailed = false;
let lastBraveRequestTime = 0;

function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function resetUsageIfNewMonth() {
  const current = getCurrentMonth();
  if (usage.month !== current) {
    usage = { exaThisMonth: 0, braveThisMonth: 0, month: current };
    exaPermanentlyFailed = false;
    bravePermanentlyFailed = false;
  }
}

function isExaAvailable(): boolean {
  resetUsageIfNewMonth();
  return !!EXA_API_KEY && !exaPermanentlyFailed && usage.exaThisMonth < EXA_SAFETY_MARGIN;
}

function isBraveAvailable(): boolean {
  resetUsageIfNewMonth();
  return !!BRAVE_API_KEY && !bravePermanentlyFailed && usage.braveThisMonth < BRAVE_SAFETY_MARGIN;
}

function isOpenRouterAvailable(): boolean {
  return !!OPENROUTER_API_KEY && !openRouterPermanentlyFailed;
}

// ───────────────────────────────────────────────
// Low-level helpers
// ───────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(
  parentSignal: AbortSignal | undefined,
  ms: number
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Timeout")), ms);

  const onAbort = () => {
    clearTimeout(timeoutId);
    controller.abort(parentSignal?.reason);
  };

  parentSignal?.addEventListener("abort", onAbort);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  opts: { retries?: number; backoff?: number } = {}
): Promise<Response> {
  const { retries = 1, backoff = 250 } = opts;
  let lastErr: Error | undefined;

  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...init, signal });
      if (res.status >= 500 && i < retries) {
        await delay(backoff * 2 ** i);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < retries) await delay(backoff * 2 ** i);
    }
  }
  throw lastErr ?? new Error("fetch failed after retries");
}

function formatResultsAsText(response: WebSearchResponse): string {
  const lines: string[] = [];

  if (response.summary) {
    lines.push(`Summary: ${response.summary}\n`);
  }

  lines.push(`Found ${response.results.length} result(s) via ${response.provider}:\n`);

  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   URL: ${r.url}`);
    if (r.publishedDate) {
      lines.push(`   Date: ${r.publishedDate}`);
    }
    if (r.excerpt) {
      const excerpt = r.excerpt.trim().replace(/\n+/g, "\n   ");
      lines.push(`   ${excerpt}`);
    }
    lines.push("");
  }

  if (response.costUsd !== undefined) {
    lines.push(`(cost: ~$${response.costUsd.toFixed(4)})`);
  }

  return lines.join("\n");
}

// ───────────────────────────────────────────────
// Providers
// ───────────────────────────────────────────────

async function exaSearch(
  input: WebSearchInput,
  parentSignal?: AbortSignal
): Promise<WebSearchResponse> {
  const { signal, cleanup } = withTimeout(parentSignal, FETCH_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      query: input.query,
      type: "auto",
      numResults: Math.min(Math.max(input.maxResults ?? 8, 1), 20),
      contents: { highlights: true },
    };

    if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
    if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
    if (input.country) body.userLocation = input.country;
    if (input.freshness) {
      const now = Date.now();
      const end = new Date(now).toISOString();
      const durations: Record<string, number> = {
        day: 86400000,
        week: 604800000,
        month: 2592000000,
        year: 31536000000,
      };
      const start = new Date(now - (durations[input.freshness] ?? 0)).toISOString();
      body.startPublishedDate = start;
      body.endPublishedDate = end;
    }

    const res = await fetchWithRetry(
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: {
          "x-api-key": EXA_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      signal
    );

    if (res.status === 401 || res.status === 403) {
      exaPermanentlyFailed = true;
      throw new Error(`Exa: invalid API key (HTTP ${res.status})`);
    }
    if (res.status === 429) {
      exaPermanentlyFailed = true;
      throw new Error(`Exa: rate limit / quota exhausted (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Exa: HTTP ${res.status} — ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    const rawResults = Array.isArray(data.results) ? data.results : [];

    const results: WebSearchResultItem[] = rawResults.map((r: any) => ({
      url: String(r.url ?? ""),
      title: String(r.title ?? "Untitled"),
      excerpt: Array.isArray(r.highlights)
        ? r.highlights.join("\n\n")
        : typeof r.text === "string"
        ? r.text.slice(0, 2000)
        : "",
      publishedDate: r.publishedDate ?? undefined,
    }));

    usage.exaThisMonth++;

    return {
      results,
      provider: "exa",
      costUsd: typeof data.costDollars?.total === "number" ? data.costDollars.total : undefined,
    };
  } finally {
    cleanup();
  }
}

async function braveSearch(
  input: WebSearchInput,
  parentSignal?: AbortSignal
): Promise<WebSearchResponse> {
  // Rate limit: max ~1 QPS on free tier
  const now = Date.now();
  const elapsed = now - lastBraveRequestTime;
  if (elapsed < BRAVE_MIN_INTERVAL_MS) {
    await delay(BRAVE_MIN_INTERVAL_MS - elapsed);
  }
  lastBraveRequestTime = Date.now();

  const { signal, cleanup } = withTimeout(parentSignal, FETCH_TIMEOUT_MS);

  try {
    const maxResults = Math.min(Math.max(input.maxResults ?? 8, 1), 20);
    const params = new URLSearchParams();
    params.set("q", input.query);
    params.set("maximum_number_of_urls", String(maxResults));
    params.set("count", String(maxResults));
    if (input.country) {
      params.set("country", input.country);
      params.set("search_lang", "en");
    }
    if (input.freshness) {
      const map: Record<string, string> = { day: "pd", week: "pw", month: "pm", year: "py" };
      if (map[input.freshness]) params.set("freshness", map[input.freshness]);
    }

    const url = `https://api.search.brave.com/res/v1/llm/context?${params.toString()}`;

    const res = await fetchWithRetry(
      url,
      {
        method: "GET",
        headers: {
          "X-Subscription-Token": BRAVE_API_KEY!,
          Accept: "application/json",
        },
      },
      signal
    );

    if (res.status === 401 || res.status === 403) {
      bravePermanentlyFailed = true;
      throw new Error(`Brave: invalid API key (HTTP ${res.status})`);
    }
    if (res.status === 429) {
      bravePermanentlyFailed = true;
      throw new Error(`Brave: rate limit / quota exhausted (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Brave: HTTP ${res.status} — ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    const generic = Array.isArray(data.grounding?.generic) ? data.grounding.generic : [];
    const sources = data.sources && typeof data.sources === "object" ? data.sources : {};

    const results: WebSearchResultItem[] = generic.map((g: any) => {
      const url = String(g.url ?? "");
      const snippets = Array.isArray(g.snippets) ? g.snippets : [];
      const source = sources[url];
      return {
        url,
        title: String(g.title ?? source?.title ?? "Untitled"),
        excerpt: snippets.join("\n\n"),
        publishedDate: source?.age?.[1] ?? undefined,
      };
    });

    usage.braveThisMonth++;

    return { results, provider: "brave" };
  } finally {
    cleanup();
  }
}

async function openRouterSearch(
  input: WebSearchInput,
  parentSignal?: AbortSignal
): Promise<WebSearchResponse> {
  const { signal, cleanup } = withTimeout(parentSignal, OPENROUTER_TIMEOUT_MS);

  try {
    const toolParams: Record<string, unknown> = {
      engine: "auto",
      max_results: Math.min(Math.max(input.maxResults ?? 8, 1), 20),
      search_context_size: "medium",
    };
    if (input.includeDomains?.length) {
      toolParams.allowed_domains = input.includeDomains;
    }
    if (input.excludeDomains?.length) {
      toolParams.excluded_domains = input.excludeDomains;
    }

    const messages = [
      {
        role: "system" as const,
        content:
          "You are a web search assistant. When given a query, you MUST use the web_search tool to find current information on the web. Always search before answering.",
      },
      {
        role: "user" as const,
        content: `Search the web for: ${input.query}`,
      },
    ];

    const body = {
      model: OPENROUTER_MODEL,
      messages,
      tools: [
        {
          type: "openrouter:web_search",
          parameters: toolParams,
        },
      ],
    };

    const res = await fetchWithRetry(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://pi.terminal",
          "X-Title": "pi-web-search",
        },
        body: JSON.stringify(body),
      },
      signal
    );

    if (res.status === 401 || res.status === 403) {
      openRouterPermanentlyFailed = true;
      throw new Error(`OpenRouter: invalid API key (HTTP ${res.status})`);
    }
    if (res.status === 429) {
      throw new Error(`OpenRouter: rate limited (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter: HTTP ${res.status} — ${text.slice(0, 500)}`);
    }

    const data = await res.json();
    const message = data.choices?.[0]?.message;
    const content = typeof message?.content === "string" ? message.content : "";

    // Track whether a web search was actually performed
    const searchRequests =
      typeof data.usage?.server_tool_use?.web_search_requests === "number"
        ? data.usage.server_tool_use.web_search_requests
        : 0;

    // Extract citations from various possible shapes
    const results: WebSearchResultItem[] = [];
    const seenUrls = new Set<string>();

    const addResult = (url: string, title: string, snippet: string) => {
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);
      results.push({ url, title: title || "Untitled", excerpt: snippet });
    };

    // Pattern 1: message.annotations
    if (Array.isArray(message?.annotations)) {
      for (const ann of message.annotations) {
        if (ann && typeof ann === "object") {
          addResult(
            ann.url ?? ann.source?.url ?? ann.link ?? "",
            ann.title ?? ann.source?.title ?? "",
            ann.snippet ?? ann.excerpt ?? ann.text ?? ""
          );
        }
      }
    }

    // Pattern 2: message.citations
    if (Array.isArray(message?.citations)) {
      for (const cit of message.citations) {
        if (cit && typeof cit === "object") {
          addResult(
            cit.url ?? cit.source?.url ?? cit.link ?? "",
            cit.title ?? cit.source?.title ?? "",
            cit.snippet ?? cit.excerpt ?? cit.text ?? ""
          );
        }
      }
    }

    // Pattern 3: provider-specific nested structures (e.g. gemini)
    if (Array.isArray(message?.annotation?.citationMetadata?.citations)) {
      for (const cit of message.annotation.citationMetadata.citations) {
        if (cit && typeof cit === "object") {
          addResult(
            cit.uri ?? cit.url ?? "",
            cit.title ?? "",
            cit.publicationDate ?? ""
          );
        }
      }
    }

    // Pattern 4: parse markdown-style [N] citation references and URLs from text
    if (results.length === 0 && content) {
      // Try to find URLs in the content
      const urlRegex = /https?:\/\/[^\s)\]\>"]+/g;
      const urls = content.match(urlRegex) ?? [];
      for (const url of urls) {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          results.push({ url, title: "Source", excerpt: "" });
        }
      }
    }

    // Cost: token cost + server tool cost. We can't compute token cost here,
    // but we can report the search request count as a rough indicator.
    const costUsd = searchRequests > 0 ? searchRequests * 0.02 : undefined;

    return {
      results,
      provider: "openrouter",
      summary: content || undefined,
      costUsd,
    };
  } finally {
    cleanup();
  }
}

// ───────────────────────────────────────────────
// Orchestrator
// ───────────────────────────────────────────────

async function runSearch(
  input: WebSearchInput,
  signal?: AbortSignal,
  onUpdate?: (text: string) => void
): Promise<WebSearchResponse> {
  const errors: string[] = [];

  const tryProvider = async (
    name: string,
    available: boolean,
    fn: () => Promise<WebSearchResponse>
  ): Promise<WebSearchResponse | null> => {
    if (!available) return null;
    onUpdate?.(`Trying ${name}…`);
    try {
      const result = await fn();
      onUpdate?.(`${name} returned ${result.results.length} result(s).`);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      onUpdate?.(`${name} failed — ${msg}`);
      return null;
    }
  };

  // If a specific provider was requested, try only that one
  if (input.provider) {
    const map: Record<string, [boolean, () => Promise<WebSearchResponse>]> = {
      exa: [isExaAvailable(), () => exaSearch(input, signal)],
      brave: [isBraveAvailable(), () => braveSearch(input, signal)],
      openrouter: [isOpenRouterAvailable(), () => openRouterSearch(input, signal)],
    };
    const [available, fn] = map[input.provider] ?? [false, async () => ({ results: [], provider: "openrouter" })];
    const result = await tryProvider(input.provider, available, fn);
    if (result) return result;
    throw new Error(
      `Provider "${input.provider}" unavailable or failed.` +
        (errors.length ? ` Errors: ${errors.join("; ")}` : "")
    );
  }

  // Fallback chain: Exa → Brave → OpenRouter
  const exa = await tryProvider("Exa", isExaAvailable(), () => exaSearch(input, signal));
  if (exa) return exa;

  const brave = await tryProvider("Brave", isBraveAvailable(), () => braveSearch(input, signal));
  if (brave) return brave;

  const or = await tryProvider("OpenRouter", isOpenRouterAvailable(), () => openRouterSearch(input, signal));
  if (or) return or;

  throw new Error(
    "All search providers failed. " +
      `Set EXA_API_KEY, BRAVE_API_KEY, or OPENROUTER_API_KEY. ` +
      `Errors: ${errors.join("; ")}`
  );
}

// ───────────────────────────────────────────────
// Extension
// ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Restore usage from persisted session entries
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "web-search-usage") {
        const data = entry.data as UsageState | undefined;
        if (data && data.month === getCurrentMonth()) {
          usage = { ...data };
        }
      }
    }
  });

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for up-to-date information. Returns a list of results with URL, title, and excerpt. " +
      "Use when the answer requires recent facts, documentation, or sources you cannot recall confidently.",
    promptSnippet: "Search the web for current facts, docs, or events",
    promptGuidelines: [
      "Use web_search when the user asks about recent events, current documentation versions, or facts that may have changed since training.",
      "Use web_search for library API documentation, version compatibility, or error messages that suggest looking up current docs.",
      "Use web_search when the user explicitly asks to search the web or find sources.",
      "If web_search returns no useful results, tell the user and stop rather than guessing.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "The search query. Be specific; include key terms, library names, version numbers, or error messages.",
      }),
      maxResults: Type.Optional(
        Type.Number({
          minimum: 1,
          maximum: 20,
          default: 8,
          description: "Maximum number of results to return.",
        })
      ),
      freshness: Type.Optional(
        StringEnum(["day", "week", "month", "year"] as const, {
          description: "Restrict to results from the last N period.",
        })
      ),
      includeDomains: Type.Optional(
        Type.Array(Type.String(), {
          description: "Restrict results to these domains (e.g. ['github.com', 'docs.python.org']).",
        })
      ),
      excludeDomains: Type.Optional(
        Type.Array(Type.String(), {
          description: "Exclude these domains from results.",
        })
      ),
      country: Type.Optional(
        Type.String({
          description: "ISO-2 country code for localised results (e.g. 'us', 'gb', 'de').",
        })
      ),
      provider: Type.Optional(
        StringEnum(["exa", "brave", "openrouter"] as const, {
          description: "Force a specific provider. If omitted, the fallback chain runs (Exa → Brave → OpenRouter).",
        })
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // Validate env
      const hasAnyKey = EXA_API_KEY || BRAVE_API_KEY || OPENROUTER_API_KEY;
      if (!hasAnyKey) {
        throw new Error(
          "No search API keys configured. Set at least one of: EXA_API_KEY, BRAVE_API_KEY, OPENROUTER_API_KEY."
        );
      }

      const input: WebSearchInput = {
        query: params.query,
        maxResults: params.maxResults,
        includeDomains: params.includeDomains,
        excludeDomains: params.excludeDomains,
        country: params.country,
        freshness: params.freshness,
        provider: params.provider,
      };

      const result = await runSearch(input, signal, (text) => {
        onUpdate?.({ content: [{ type: "text", text }], details: {} });
      });

      // Persist usage after successful search
      pi.appendEntry("web-search-usage", { ...usage });

      const text = formatResultsAsText(result);

      // Truncate to avoid overwhelming context
      const truncated = truncateHead(text, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let finalText = truncated.content;
      if (truncated.truncated) {
        finalText +=
          `\n\n[Output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines]`;
      }

      return {
        content: [{ type: "text", text: finalText }],
        details: {
          provider: result.provider,
          resultCount: result.results.length,
          costUsd: result.costUsd,
          summary: result.summary,
          results: result.results,
        },
      };
    },
  });

  pi.registerCommand("search-stats", {
    description: "Show web-search provider usage and quota status",
    handler: async (_args, ctx) => {
      resetUsageIfNewMonth();
      const lines: string[] = [];
      lines.push(`Month: ${usage.month}`);
      lines.push("");
      lines.push(`Exa:      ${usage.exaThisMonth} / ${EXA_FREE_TIER}  ${isExaAvailable() ? "✅ available" : "❌ unavailable"}`);
      lines.push(`Brave:    ${usage.braveThisMonth} / ${BRAVE_FREE_TIER}  ${isBraveAvailable() ? "✅ available" : "❌ unavailable"}`);
      lines.push(`OpenRouter: ${isOpenRouterAvailable() ? "✅ available" : "❌ unavailable"}  (paid, no quota tracking)`);
      lines.push("");
      lines.push(`Fallback chain: Exa → Brave → OpenRouter`);
      if (!EXA_API_KEY && !BRAVE_API_KEY && !OPENROUTER_API_KEY) {
        lines.push("");
        lines.push("⚠️  No API keys configured.");
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
