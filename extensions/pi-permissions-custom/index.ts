/**
 * pi-permissions-custom
 *
 * Claude Code-style permission modes for pi with tweakable global rules.
 *
 * Permission modes:
 * - default:          Ask for writes/edits and all bash commands
 * - acceptEdits:      Auto-approve writes/edits, ask for bash
 * - fullAuto:         Auto-approve writes/edits and safe bash, ask for dangerous bash
 * - bypassPermissions: Auto-approve everything except catastrophic commands and protected paths
 *
 * Catastrophic commands and protected paths are ALWAYS blocked regardless of mode.
 * Shell tricks always require individual confirmation (cannot be session-approved).
 *
 * Commands:
 * - /permissions              Interactive mode selector
 * - /permissions <mode>       Set mode directly (default | acceptEdits | fullAuto | bypassPermissions)
 * - /permissions:status       Show current mode and session approvals
 * - /permissions:reload       Reload rules.json without restarting
 *
 * Keyboard shortcut:
 * - Ctrl+Shift+P              Cycle through permission modes
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type PermissionMode = "default" | "acceptEdits" | "fullAuto" | "bypassPermissions";

interface PatternRule {
	pattern: string;
	description: string;
}

interface RulesConfig {
	mode: PermissionMode;
	catastrophicPatterns: PatternRule[];
	dangerousPatterns: PatternRule[];
	protectedPaths: string[];
	shellTrickPatterns: PatternRule[];
}

const MODES: PermissionMode[] = ["default", "acceptEdits", "fullAuto", "bypassPermissions"];

const MODE_LABELS: Record<PermissionMode, string> = {
	default: "⏵ Default",
	acceptEdits: "⏵⏵ Accept Edits",
	fullAuto: "⏵⏵⏵ Full Auto",
	bypassPermissions: "⏵⏵⏵⏵ Bypass Permissions",
};

function getRulesPath(): string {
	return join(getAgentDir(), "extensions", "pi-permissions-custom", "rules.json");
}

function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function loadRules(): RulesConfig {
	const path = getRulesPath();
	if (!existsSync(path)) {
		return {
			mode: "default",
			catastrophicPatterns: [],
			dangerousPatterns: [],
			protectedPaths: [],
			shellTrickPatterns: [],
		};
	}
	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content) as RulesConfig;
	} catch {
		return {
			mode: "default",
			catastrophicPatterns: [],
			dangerousPatterns: [],
			protectedPaths: [],
			shellTrickPatterns: [],
		};
	}
}

function matchesAnyPattern(text: string, patterns: PatternRule[]): boolean {
	return patterns.some((p) => text.includes(p.pattern));
}

function matchesProtectedPath(text: string, protectedPaths: string[]): boolean {
	const expanded = expandHome(text);
	return protectedPaths.some((p) => {
		const exp = expandHome(p);
		return expanded.includes(exp);
	});
}

export default function (pi: ExtensionAPI) {
	let rules = loadRules();
	let currentMode: PermissionMode = rules.mode ?? "default";

	// Session-level approvals
	const sessionApprovals = new Set<string>();
	const approvedTools = new Set<string>();

	function getApprovalKey(toolName: string, input: Record<string, unknown>): string {
		if (toolName === "bash") {
			return `bash:${input.command}`;
		}
		if (toolName === "write" || toolName === "edit" || toolName === "read") {
			return `${toolName}:${input.path}`;
		}
		return `${toolName}:${JSON.stringify(input)}`;
	}

	function isApproved(toolName: string, input: Record<string, unknown>): boolean {
		if (approvedTools.has(toolName)) return true;
		return sessionApprovals.has(getApprovalKey(toolName, input));
	}

	function approveOnce(toolName: string, input: Record<string, unknown>) {
		sessionApprovals.add(getApprovalKey(toolName, input));
	}

	function approveForSession(toolName: string) {
		approvedTools.add(toolName);
	}

	function resetApprovals() {
		sessionApprovals.clear();
		approvedTools.clear();
	}

	function reloadRules() {
		rules = loadRules();
		currentMode = rules.mode ?? "default";
		resetApprovals();
	}

	function isCatastrophic(toolName: string, input: Record<string, unknown>): { blocked: boolean; reason?: string } {
		if (toolName === "bash") {
			const command = (input.command as string) ?? "";
			if (matchesAnyPattern(command, rules.catastrophicPatterns)) {
				return { blocked: true, reason: `Catastrophic command blocked: ${command}` };
			}
		}
		return { blocked: false };
	}

	function isProtectedPath(toolName: string, input: Record<string, unknown>): { blocked: boolean; reason?: string } {
		if (toolName === "write" || toolName === "edit") {
			const path = (input.path as string) ?? "";
			if (matchesProtectedPath(path, rules.protectedPaths)) {
				return { blocked: true, reason: `Protected path blocked: ${path}` };
			}
		}
		if (toolName === "bash") {
			const command = (input.command as string) ?? "";
			if (matchesProtectedPath(command, rules.protectedPaths)) {
				return { blocked: true, reason: `Protected path referenced in command` };
			}
		}
		return { blocked: false };
	}

	function isDangerousBash(command: string): { dangerous: boolean; matched?: string } {
		for (const rule of rules.dangerousPatterns) {
			if (command.includes(rule.pattern)) {
				return { dangerous: true, matched: rule.description };
			}
		}
		return { dangerous: false };
	}

	function containsShellTrick(command: string): { found: boolean; matched?: string } {
		for (const rule of rules.shellTrickPatterns) {
			if (command.includes(rule.pattern)) {
				return { found: true, matched: rule.description };
			}
		}
		return { found: false };
	}

	type ApprovalResult = { ok: true } | { ok: false; reason: string };

	async function promptForApproval(
		toolName: string,
		input: Record<string, unknown>,
		reason: string,
		ctx: ExtensionContext,
		allowSessionApproval: boolean,
	): Promise<ApprovalResult> {
		if (!ctx.hasUI) {
			return { ok: false, reason: "Blocked by user (no UI)" };
		}

		const summary = toolName === "bash"
			? `bash: ${input.command}`
			: `${toolName}: ${JSON.stringify(input).slice(0, 200)}`;

		const options = [
			"Allow once",
			...(allowSessionApproval ? ["Allow for session"] : []),
			"Deny",
			"Custom response...",
		];

		const choice = await ctx.ui.select(
			`Permission required\n\n${reason}\n\n${summary}`,
			options,
		);

		if (choice === "Allow once") {
			approveOnce(toolName, input);
			return { ok: true };
		}
		if (choice === "Allow for session") {
			approveForSession(toolName);
			return { ok: true };
		}
		if (choice === "Custom response...") {
			const text = await ctx.ui.input(
				"Custom response:",
				"e.g. yes, but use single quotes / no, use foo instead",
			);
			if (!text || !text.trim()) {
				return { ok: false, reason: "Blocked by user (empty response)" };
			}
			const trimmed = text.trim();
			const lower = trimmed.toLowerCase();
			const allow = ["y", "yes", "allow", "ok", "sure", "approve", "go ahead"].some((p) =>
				lower.startsWith(p)
			);
			const session = allow && ["session", "all", "always"].some((w) => lower.includes(w));

			if (allow) {
				if (session) {
					approveForSession(toolName);
				} else {
					approveOnce(toolName, input);
				}
				pi.sendUserMessage(`Approved (${toolName}): ${trimmed}`, { deliverAs: "steer" });
				return { ok: true };
			}
			pi.sendUserMessage(`Denied (${toolName}): ${trimmed}`, { deliverAs: "steer" });
			return { ok: false, reason: `Blocked by user: ${trimmed}` };
		}
		return { ok: false, reason: "Blocked by user" };
	}

	// ─── Tool call handler ───────────────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		const { toolName, input } = event;

		// 1. Always block catastrophic
		const catastrophic = isCatastrophic(toolName, input);
		if (catastrophic.blocked) {
			if (ctx.hasUI) ctx.ui.notify(catastrophic.reason!, "error");
			return { block: true, reason: catastrophic.reason };
		}

		// 2. Always block protected paths
		const protectedPath = isProtectedPath(toolName, input);
		if (protectedPath.blocked) {
			if (ctx.hasUI) ctx.ui.notify(protectedPath.reason!, "error");
			return { block: true, reason: protectedPath.reason };
		}

		// 3. Check session approvals
		if (isApproved(toolName, input)) {
			return undefined;
		}

		// 4. Mode-based logic
		if (toolName === "write" || toolName === "edit") {
			if (currentMode === "default") {
				const result = await promptForApproval(toolName, input, `Write/edit requires confirmation`, ctx, true);
				if (!result.ok) return { block: true, reason: result.reason };
				return undefined;
			}
			// acceptEdits, fullAuto, bypassPermissions -> auto-allow
			return undefined;
		}

		if (toolName === "bash") {
			const command = (input.command as string) ?? "";
			const shellTrick = containsShellTrick(command);
			const dangerous = isDangerousBash(command);

			if (shellTrick.found) {
				// Shell tricks always require individual confirmation except in bypass
				if (currentMode === "bypassPermissions") {
					return undefined;
				}
				const result = await promptForApproval(
					toolName,
					input,
					`⚠️ Shell trick detected (${shellTrick.matched})`,
					ctx,
					false, // no session approval for shell tricks
				);
				if (!result.ok) return { block: true, reason: result.reason };
				return undefined;
			}

			if (currentMode === "default" || currentMode === "acceptEdits") {
				const result = await promptForApproval(toolName, input, `Bash command requires confirmation`, ctx, true);
				if (!result.ok) return { block: true, reason: result.reason };
				return undefined;
			}

			if (currentMode === "fullAuto") {
				if (dangerous.dangerous) {
					const result = await promptForApproval(
						toolName,
						input,
						`Dangerous bash command detected (${dangerous.matched})`,
						ctx,
						true,
					);
					if (!result.ok) return { block: true, reason: result.reason };
					return undefined;
				}
				// Safe bash -> auto-allow
				return undefined;
			}

			// bypassPermissions -> auto-allow
			return undefined;
		}

		// For other tools, allow in all modes (unless catastrophic/protected path blocked above)
		return undefined;
	});

	// ─── Commands ────────────────────────────────────────────────────────────────

	pi.registerCommand("permissions", {
		description: "Set or view permission mode",
		handler: async (args, ctx) => {
			const arg = args?.trim();

			if (!arg) {
				// Interactive selector
				const choice = await ctx.ui.select(
					"Select permission mode",
					MODES.map((m) => MODE_LABELS[m]),
				);
				const idx = MODES.findIndex((m) => MODE_LABELS[m] === choice);
				if (idx !== -1) {
					currentMode = MODES[idx];
					resetApprovals();
					ctx.ui.notify(`Permission mode: ${MODE_LABELS[currentMode]}`, "success");
				}
				return;
			}

			if (arg === "status" || arg === ":status") {
				const approvedList = Array.from(approvedTools).join(", ") || "none";
				const sessionList = Array.from(sessionApprovals).join("\n") || "none";
				ctx.ui.notify(
					`Mode: ${MODE_LABELS[currentMode]}\nSession-approved tools: ${approvedList}\nSession-approved calls: ${sessionList.length} items`,
					"info",
				);
				return;
			}

			if (arg === "reload" || arg === ":reload") {
				reloadRules();
				ctx.ui.notify(`Rules reloaded. Mode: ${MODE_LABELS[currentMode]}`, "success");
				return;
			}

			const mode = arg as PermissionMode;
			if (MODES.includes(mode)) {
				currentMode = mode;
				resetApprovals();
				ctx.ui.notify(`Permission mode: ${MODE_LABELS[currentMode]}`, "success");
			} else {
				ctx.ui.notify(`Unknown mode: ${arg}. Use: ${MODES.join(", ")}`, "error");
			}
		},
	});

	// ─── Shortcut ────────────────────────────────────────────────────────────────

	pi.registerShortcut("ctrl+shift+p", {
		description: "Cycle permission modes",
		handler: async (ctx) => {
			const idx = MODES.indexOf(currentMode);
			currentMode = MODES[(idx + 1) % MODES.length];
			resetApprovals();
			ctx.ui.notify(`Permission mode: ${MODE_LABELS[currentMode]}`, "success");
		},
	});

	// ─── CLI Flags ───────────────────────────────────────────────────────────────

	pi.registerFlag("default", { type: "boolean", default: false, description: "Start in default permission mode" });
	pi.registerFlag("accept-edits", { type: "boolean", default: false, description: "Start in acceptEdits permission mode" });
	pi.registerFlag("full-auto", { type: "boolean", default: false, description: "Start in fullAuto permission mode" });
	pi.registerFlag("bypass-permissions", { type: "boolean", default: false, description: "Start in bypassPermissions mode" });

	function applyFlagOverrides() {
		if (pi.getFlag("default")) currentMode = "default";
		else if (pi.getFlag("accept-edits")) currentMode = "acceptEdits";
		else if (pi.getFlag("full-auto")) currentMode = "fullAuto";
		else if (pi.getFlag("bypass-permissions")) currentMode = "bypassPermissions";
	}

	applyFlagOverrides();

	// ─── Startup notification ────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.notify(
			`pi-permissions-custom active | Mode: ${MODE_LABELS[currentMode]} | /permissions for settings`,
			"info",
		);
	});
}
