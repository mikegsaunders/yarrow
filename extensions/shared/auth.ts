/**
 * Credential lookup shared by yarrow's extensions.
 *
 * One rule for every key: environment variables first, then pi's `auth.json`.
 * Not loaded as an extension itself -- see the `pi.extensions` globs in package.json.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

interface AuthEntry {
	type?: string;
	key?: string;
}

let cached: Record<string, AuthEntry> | undefined;

function loadAuthFile(): Record<string, AuthEntry> {
	if (cached) return cached;
	const candidates = [
		join(getAgentDir(), "auth.json"),
		join(homedir(), ".local", "share", "pi", "auth.json"),
	];
	for (const path of candidates) {
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
			if (parsed && typeof parsed === "object") {
				cached = parsed as Record<string, AuthEntry>;
				return cached;
			}
		} catch {
			// Missing or unreadable: try the next location.
		}
	}
	cached = {};
	return cached;
}

/**
 * pi allows an auth.json value to be a literal key or the name of an environment
 * variable holding it. A `!command` value shells out, which is not supported here.
 */
function readAuthEntry(entry: AuthEntry | undefined): string | undefined {
	const key = entry?.key;
	if (!key || key.startsWith("!")) return undefined;
	if (/^[A-Z_][A-Z0-9_]*$/.test(key) && process.env[key]) return process.env[key];
	return key;
}

/** First hit wins: each environment variable in order, then each auth.json entry. */
export function resolveApiKey(sources: { env?: string[]; auth?: string[] }): string | undefined {
	for (const name of sources.env ?? []) {
		const value = process.env[name];
		if (value) return value;
	}
	const auth = loadAuthFile();
	for (const name of sources.auth ?? []) {
		const value = readAuthEntry(auth[name]);
		if (value) return value;
	}
	return undefined;
}
