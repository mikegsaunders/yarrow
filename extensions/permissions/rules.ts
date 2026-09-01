/**
 * The deterministic half of the permission gate: rules loading, matching, and the
 * decision about which tier a tool call falls into.
 *
 * Everything here is free and offline. It runs before the classifier and decides
 * what the classifier never gets a say over.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface PatternRule {
	pattern: string;
	description: string;
	/** "literal" (default) matches on token boundaries; "regex" matches the pattern as written. */
	match?: "literal" | "regex";
}

export interface ClassifierConfig {
	provider: string;
	model: string;
	/** Consecutive blocks before the agent is allowed to put the question to you. */
	blocksBeforeAsking: number;
}

interface RulesConfig {
	catastrophicPatterns: PatternRule[];
	dangerousPatterns: PatternRule[];
	shellTrickPatterns: PatternRule[];
	protectedPaths: string[];
	secretPaths: string[];
	autoApprovedCommands: string[];
	classifier: ClassifierConfig;
}

interface CompiledRule extends PatternRule {
	regex: RegExp;
}

export interface CompiledRules {
	catastrophic: CompiledRule[];
	dangerous: CompiledRule[];
	shellTricks: CompiledRule[];
	protectedPaths: string[];
	secretPaths: string[];
	autoApprovedCommands: Set<string>;
	classifier: ClassifierConfig;
	userRulesLoaded: boolean;
}

const PACKAGED_RULES_PATH = fileURLToPath(new URL("./rules.json", import.meta.url));

export function userRulesPath(): string {
	return join(getAgentDir(), "yarrow", "permissions.json");
}

const FALLBACK_CLASSIFIER: ClassifierConfig = {
	provider: "openrouter",
	model: "@preset/flash",
	blocksBeforeAsking: 2,
};

const EMPTY_RULES: RulesConfig = {
	catastrophicPatterns: [],
	dangerousPatterns: [],
	shellTrickPatterns: [],
	protectedPaths: [],
	secretPaths: [],
	autoApprovedCommands: [],
	classifier: FALLBACK_CLASSIFIER,
};

function readJson(path: string): Partial<RulesConfig> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Partial<RulesConfig>;
	} catch {
		return undefined;
	}
}

/**
 * Packaged defaults, overridden per top-level key by the user's rules file.
 * A key present in the user file replaces that key entirely; absent keys inherit
 * the packaged defaults, so updates to categories you haven't touched still land.
 */
export function loadRules(): CompiledRules {
	const packaged = readJson(PACKAGED_RULES_PATH) ?? {};
	const user = readJson(userRulesPath());
	const merged: RulesConfig = { ...EMPTY_RULES, ...packaged, ...(user ?? {}) };

	return {
		catastrophic: compile(merged.catastrophicPatterns),
		dangerous: compile(merged.dangerousPatterns),
		shellTricks: compile(merged.shellTrickPatterns),
		protectedPaths: merged.protectedPaths ?? [],
		secretPaths: merged.secretPaths ?? [],
		autoApprovedCommands: new Set(merged.autoApprovedCommands ?? []),
		classifier: { ...FALLBACK_CLASSIFIER, ...(merged.classifier ?? {}) },
		userRulesLoaded: user !== undefined,
	};
}

// ─── Pattern matching ──────────────────────────────────────────────────────

const WORD_CHAR = /[A-Za-z0-9_]/;

export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/**
 * Literal patterns match on token boundaries, not raw substrings: `dd` no longer
 * fires on `git add .`, and `sudo  rm  -rf  /` still matches `sudo rm -rf /`
 * because both sides are whitespace-normalised first. Boundaries are only applied
 * where the pattern edge is a word character, so `| sh` style patterns still work.
 * A rule can opt into `"match": "regex"` when it needs more precision than that --
 * `rm -rf /` must not fire on `rm -rf /tmp/build`.
 */
function compile(rules: PatternRule[] | undefined): CompiledRule[] {
	return (rules ?? []).flatMap((rule) => {
		try {
			if (rule.match === "regex") {
				return [{ ...rule, regex: new RegExp(rule.pattern) }];
			}
			const pattern = normalizeWhitespace(rule.pattern);
			const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const prefix = WORD_CHAR.test(pattern.slice(0, 1)) ? "\\b" : "";
			const suffix = WORD_CHAR.test(pattern.slice(-1)) ? "\\b" : "";
			return [{ ...rule, regex: new RegExp(`${prefix}${escaped}${suffix}`) }];
		} catch {
			// A malformed user pattern must not take the whole rule set down.
			return [];
		}
	});
}

function matchRule(command: string, rules: CompiledRule[]): CompiledRule | undefined {
	const normalized = normalizeWhitespace(command);
	return rules.find((rule) => rule.regex.test(normalized));
}

// ─── Paths ──────────────────────────────────────────────────────────────

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (path === "$HOME") return homedir();
	if (path.startsWith("$HOME/")) return join(homedir(), path.slice(6));
	return path;
}

function toAbsolute(path: string, cwd: string): string {
	const expanded = expandHome(path);
	return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

function isUnder(target: string, base: string): boolean {
	return target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
}

function matchPathList(candidates: string[], list: string[], cwd: string): string | undefined {
	const bases = list.map((entry) => toAbsolute(entry, cwd));
	for (const candidate of candidates) {
		const abs = toAbsolute(candidate, cwd);
		const hit = bases.findIndex((base) => isUnder(abs, base));
		if (hit !== -1) return list[hit];
	}
	return undefined;
}

/**
 * Pull path-looking tokens out of a shell command. Resolving tokens beats substring
 * matching on the whole command: `cat ~/.ssh/id_rsa`, `cat $HOME/.ssh/id_rsa` and
 * `cat /home/me/.ssh/id_rsa` all resolve to the same place, and an unrelated command
 * that merely mentions the text does not.
 */
function extractPathTokens(command: string): string[] {
	return command
		.split(/[\s;&|<>()]+/)
		.map((token) => token.replace(/^['"]+|['"]+$/g, ""))
		.filter(
			(token) =>
				token.length > 1 &&
				(token.startsWith("~") ||
					token.startsWith("$HOME") ||
					token.startsWith(".") ||
					token.includes("/")),
		);
}

function pathsForTool(toolName: string, input: Record<string, unknown>): string[] {
	if (toolName === "bash") return extractPathTokens((input.command as string) ?? "");
	const path = input.path;
	return typeof path === "string" && path.length > 0 ? [path] : [];
}

// ─── Tiering ─────────────────────────────────────────────────────────────

export const COMPOUND_COMMAND = /[;&|\n]|\$\(|`/;

const MUTATING_TOOLS = new Set(["bash", "write", "edit"]);

export type Decision =
	/** Runs with no further checks. */
	| { tier: "allow" }
	/** Never runs, in any circumstance. */
	| { tier: "deny"; reason: string }
	/** Only a human can approve this one. */
	| { tier: "ask"; reason: string }
	/** Hand it to the classifier. */
	| { tier: "classify" };

/**
 * Which tier a tool call falls into.
 *
 * deny > ask > allow > classify. The first three are the deterministic floor: they
 * cost nothing, work offline, and the classifier cannot argue with them.
 */
export function decide(
	toolName: string,
	input: Record<string, unknown>,
	rules: CompiledRules,
	cwd: string,
	options: { bypass?: boolean } = {},
): Decision {
	const command = toolName === "bash" ? ((input.command as string) ?? "") : "";

	// 1. Deny. No mode, flag, or classifier verdict gets past this.
	if (command) {
		const catastrophic = matchRule(command, rules.catastrophic);
		if (catastrophic) {
			return { tier: "deny", reason: `Catastrophic command (${catastrophic.description})` };
		}
	}

	const paths = pathsForTool(toolName, input);
	const secret = matchPathList(paths, rules.secretPaths, cwd);
	if (secret) return { tier: "deny", reason: `Secret path: ${secret}` };

	const protectedPath = matchPathList(paths, rules.protectedPaths, cwd);
	if (protectedPath && (toolName === "write" || toolName === "edit")) {
		return { tier: "deny", reason: `Protected path: ${protectedPath}` };
	}

	if (options.bypass) return { tier: "allow" };

	// 2. Ask. Destructive enough that a human, not a model, should sign it off.
	if (protectedPath && toolName === "bash") {
		return { tier: "ask", reason: `Command references protected path ${protectedPath}` };
	}
	if (command) {
		const trick = matchRule(command, rules.shellTricks);
		if (trick) return { tier: "ask", reason: `Shell trick hides the real command (${trick.description})` };

		const dangerous = matchRule(command, rules.dangerous);
		if (dangerous) return { tier: "ask", reason: `Dangerous command (${dangerous.description})` };
	}

	// 3. Allow. Reads, and the everyday commands that would only waste a classifier call.
	if (!MUTATING_TOOLS.has(toolName)) return { tier: "allow" };

	if (toolName === "bash") {
		const normalized = normalizeWhitespace(command);
		const head = normalized.split(" ")[0] ?? "";
		if (!COMPOUND_COMMAND.test(normalized) && rules.autoApprovedCommands.has(head)) {
			return { tier: "allow" };
		}
	}

	// Editing inside the working directory is the job. Outside it is worth a look.
	if (toolName === "write" || toolName === "edit") {
		const path = typeof input.path === "string" ? input.path : "";
		if (path && isUnder(toAbsolute(path, cwd), resolve(cwd))) return { tier: "allow" };
	}

	// 4. Everything else is the classifier's problem.
	return { tier: "classify" };
}
