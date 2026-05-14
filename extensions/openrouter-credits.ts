import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Credits {
	total_credits: number;
	total_usage: number;
}

async function fetchCredits(apiKey: string, signal?: AbortSignal): Promise<Credits | null> {
	try {
		const res = await fetch("https://openrouter.ai/api/v1/credits", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal,
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { data?: Credits };
		return json.data ?? null;
	} catch {
		return null;
	}
}

function resolveApiKey(): string | undefined {
	try {
		const authPath = join(homedir(), ".pi", "agent", "auth.json");
		const raw = readFileSync(authPath, "utf-8");
		const auth = JSON.parse(raw) as Record<string, { type: string; key: string }>;
		const entry = auth["openrouter"];
		if (!entry || entry.type !== "api_key") return undefined;

		const key = entry.key;
		if (key.startsWith("!")) {
			// Shell command - not supported here, skip
			return undefined;
		}
		if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key]) {
			// Looks like an env var name and exists in env
			return process.env[key];
		}
		// Literal value
		return key;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	let credits: Credits | null = null;
	let error = false;
	let requestRender: (() => void) | undefined;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		const apiKey = resolveApiKey();
		if (!apiKey) return;

		const refresh = async (signal?: AbortSignal) => {
			const result = await fetchCredits(apiKey, signal);
			if (result) {
				credits = result;
				error = false;
			} else {
				error = true;
			}
		};

		await refresh();

		// Refresh balance after every turn (when tokens are actually spent)
		pi.on("turn_end", async (_event, turnCtx) => {
			await refresh(turnCtx.signal);
			requestRender?.();
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: () => {
					unsub();
				},
				invalidate() {},
				render(width: number): string[] {
					// Session stats
					let input = 0, output = 0, cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as {
								usage?: {
									input?: number;
									output?: number;
									cost?: { total?: number };
								};
							};
							input += m.usage?.input ?? 0;
							output += m.usage?.output ?? 0;
							cost += m.usage?.cost?.total ?? 0;
						}
					}
					const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

					// OpenRouter credits
					let orText = "";
					if (credits) {
						const remaining = credits.total_credits - credits.total_usage;
						orText = theme.fg("dim", `$${remaining.toFixed(2)}`);
					} else if (error) {
						orText = theme.fg("dim", "$?");
					}

					// Build left side: stats + credits + extension statuses
					const leftParts: string[] = [];
					leftParts.push(theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`));
					if (orText) leftParts.push(orText);

					for (const [, text] of footerData.getExtensionStatuses()) {
						leftParts.push(text);
					}

					const left = leftParts.join("  ");

					// Right side: model + git branch
					const branch = footerData.getGitBranch();
					const branchStr = branch ? ` (${branch})` : "";
					const right = theme.fg("dim", `${ctx.model?.id || "no-model"}${branchStr}`);

					const padLen = width - visibleWidth(left) - visibleWidth(right);
					const pad = padLen > 0 ? " ".repeat(padLen) : " ";
					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	});
}
