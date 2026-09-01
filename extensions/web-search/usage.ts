/**
 * Monthly search counts, persisted to disk.
 *
 * Free-tier quotas are monthly and machine-wide, so the counters have to outlive a
 * single session -- tracking them in session entries reset the budget every time you
 * started pi, which made the safety margins meaningless.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type MeteredProvider = "exa" | "brave";

export interface UsageState {
	month: string; // YYYY-MM, UTC
	exa: number;
	brave: number;
}

export const USAGE_PATH = join(getAgentDir(), "yarrow", "web-search-usage.json");

export function currentMonth(): string {
	const now = new Date();
	return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyState(): UsageState {
	return { month: currentMonth(), exa: 0, brave: 0 };
}

let state: UsageState | undefined;

function read(): UsageState {
	try {
		const parsed = JSON.parse(readFileSync(USAGE_PATH, "utf-8")) as Partial<UsageState>;
		if (parsed.month === currentMonth()) {
			return {
				month: parsed.month,
				exa: typeof parsed.exa === "number" ? parsed.exa : 0,
				brave: typeof parsed.brave === "number" ? parsed.brave : 0,
			};
		}
	} catch {
		// No usable file yet: start the month at zero.
	}
	return emptyState();
}

/** Current counts, rolling over automatically at the start of a new month. */
export function getUsage(): UsageState {
	if (!state || state.month !== currentMonth()) state = read();
	return state;
}

export function recordSearch(provider: MeteredProvider): void {
	const usage = getUsage();
	usage[provider] += 1;
	try {
		mkdirSync(dirname(USAGE_PATH), { recursive: true });
		writeFileSync(USAGE_PATH, `${JSON.stringify(usage, null, 2)}\n`, "utf-8");
	} catch {
		// An unwritable state file must not fail the search the user asked for.
	}
}
