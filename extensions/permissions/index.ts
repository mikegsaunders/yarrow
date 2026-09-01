/**
 * yarrow/permissions
 *
 * One behaviour, no modes: every tool call is judged before it runs.
 *
 *   deny      catastrophic commands, secret paths, writes to protected paths.
 *             Never runs. Free, offline, no appeal.
 *   ask       dangerous commands and shell tricks. Only a human approves these.
 *   allow     reads, everyday commands, edits inside the working directory.
 *   classify  everything else goes to a small fast model, which allows it or
 *             blocks it with a reason the agent can act on.
 *
 * A classifier block is not a prompt: the agent is told why and picks another
 * approach. Only if it keeps hitting the wall does the question reach you.
 *
 * Commands: /permissions shows what is loaded, /permissions reload re-reads it.
 * Flag: --bypass-permissions keeps the deny tier and skips the rest.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classify, loadTrustBoundary, type Verdict } from "./classifier.ts";
import { decide, loadRules, userRulesPath, type CompiledRules } from "./rules.ts";

const STATUS_KEY = "yarrow-permissions";

function summarize(toolName: string, input: Record<string, unknown>): string {
	return toolName === "bash"
		? `bash: ${input.command}`
		: `${toolName}: ${JSON.stringify(input).slice(0, 200)}`;
}

export default function (pi: ExtensionAPI) {
	let rules: CompiledRules = loadRules();

	/** Verdicts for identical calls, so a retried command is not re-billed. */
	const verdictCache = new Map<string, Verdict>();
	/** Consecutive classifier blocks; enough of them and the agent may ask you instead. */
	let blockStreak = 0;
	let blockedThisSession = 0;
	let askedThisSession = 0;

	pi.registerFlag("bypass-permissions", {
		type: "boolean",
		default: false,
		description: "Skip the classifier and the ask tier. Catastrophic commands and secret paths are still blocked.",
	});

	const bypass = (): boolean => pi.getFlag("bypass-permissions") === true;

	async function askHuman(
		toolName: string,
		input: Record<string, unknown>,
		reason: string,
		ctx: ExtensionContext,
	): Promise<{ ok: true } | { ok: false; reason: string }> {
		if (!ctx.hasUI) {
			return {
				ok: false,
				reason: `${reason}. This run is non-interactive, so nobody can approve it; re-run with --bypass-permissions to allow it.`,
			};
		}

		askedThisSession++;
		const choice = await ctx.ui.select(
			`Permission required\n\n${reason}\n\n${summarize(toolName, input)}`,
			["Allow once", "Deny", "Custom response..."],
		);

		if (choice === "Allow once") return { ok: true };

		if (choice === "Custom response...") {
			const text = await ctx.ui.input(
				"Custom response:",
				"e.g. yes, but use single quotes / no, use foo instead",
			);
			const trimmed = text?.trim();
			if (!trimmed) return { ok: false, reason: "Blocked by user (empty response)" };

			const lower = trimmed.toLowerCase();
			const allow = ["y", "yes", "allow", "ok", "sure", "approve", "go ahead"].some((word) =>
				lower.startsWith(word),
			);
			pi.sendUserMessage(`${allow ? "Approved" : "Denied"} (${toolName}): ${trimmed}`, {
				deliverAs: "steer",
			});
			return allow ? { ok: true } : { ok: false, reason: `Blocked by user: ${trimmed}` };
		}

		return { ok: false, reason: "Blocked by user" };
	}

	pi.on("tool_call", async (event, ctx) => {
		const { toolName, input } = event;
		const decision = decide(toolName, input, rules, ctx.cwd, { bypass: bypass() });

		if (decision.tier === "allow") return undefined;

		if (decision.tier === "deny") {
			blockedThisSession++;
			if (ctx.hasUI) ctx.ui.notify(decision.reason, "error");
			return { block: true, reason: `Blocked: ${decision.reason}. This one is never allowed.` };
		}

		if (decision.tier === "ask") {
			const result = await askHuman(toolName, input, decision.reason, ctx);
			if (result.ok) return undefined;
			blockedThisSession++;
			return { block: true, reason: result.reason };
		}

		// classify
		const key = `${toolName}:${JSON.stringify(input)}`;
		let verdict = verdictCache.get(key);
		if (!verdict) {
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "auto · checking");
			verdict = await classify(toolName, input, rules.classifier, ctx);
			if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, "auto");
			// An unreachable classifier is a transient state, not a decision to cache.
			if (!verdict.indeterminate) verdictCache.set(key, verdict);
		}

		if (verdict.allow) {
			blockStreak = 0;
			return undefined;
		}

		// The classifier could not decide, so fall back to the human.
		if (verdict.indeterminate) {
			const result = await askHuman(toolName, input, verdict.reason, ctx);
			if (result.ok) return undefined;
			blockedThisSession++;
			return { block: true, reason: result.reason };
		}

		blockStreak++;
		blockedThisSession++;

		// The agent has tried and been refused repeatedly: stop stonewalling and let
		// it put the question to a human.
		if (blockStreak >= rules.classifier.blocksBeforeAsking) {
			blockStreak = 0;
			const result = await askHuman(toolName, input, `Blocked repeatedly: ${verdict.reason}`, ctx);
			if (result.ok) return undefined;
			return { block: true, reason: result.reason };
		}

		return {
			block: true,
			reason:
				`Blocked: ${verdict.reason.replace(/[.\s]+$/, "")}. ` +
				"Find an approach that avoids this, or ask the user to run it themselves.",
		};
	});

	pi.registerCommand("permissions", {
		description: "Show what the permission gate is enforcing",
		handler: async (args, ctx) => {
			const arg = args?.trim() ?? "";

			if (arg === "reload" || arg === ":reload") {
				rules = loadRules();
				verdictCache.clear();
				ctx.ui.notify("Permission rules reloaded", "info");
				return;
			}

			const { provider, model, blocksBeforeAsking } = rules.classifier;
			ctx.ui.notify(
				[
					bypass() ? "Mode: bypass (deny tier only)" : "Mode: auto",
					`Classifier: ${provider}/${model}, asks after ${blocksBeforeAsking} blocks`,
					`This session: ${blockedThisSession} blocked, ${askedThisSession} asked, ${verdictCache.size} cached`,
					`Rules: packaged defaults${rules.userRulesLoaded ? " + " : ", no overrides at "}${userRulesPath()}`,
				].join("\n"),
				"info",
			);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await loadTrustBoundary(ctx.cwd);
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, bypass() ? "bypass" : "auto");
	});
}
