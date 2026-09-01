#!/usr/bin/env node
/**
 * Merge Yarrow's opinions into pi's config files.
 *
 * Pi owns settings.json and keybindings.json -- it writes to them when you change a
 * model, theme or binding in-session. So Yarrow merges keys into those files instead
 * of replacing or symlinking them: a key you have already set is left alone and
 * reported, and `--force` applies Yarrow's value instead.
 *
 * Usage: apply-config.mjs [--force] [--dry-run]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent");

const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");

const green = (s) => `\x1b[0;32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[1;33m${s}\x1b[0m`;
const info = (s) => console.log(`${green("[yarrow]")} ${s}`);
const warn = (s) => console.log(`${yellow("[yarrow]")} ${s}`);

/** The rc file whose aliases pi should expand in shell commands. */
function shellRc() {
	const shell = process.env.SHELL ?? "";
	if (shell.endsWith("zsh")) return "~/.zshrc";
	if (shell.endsWith("fish")) return "~/.config/fish/config.fish";
	return "~/.bashrc";
}

function readJson(path, fallback) {
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return fallback;
	}
}

function substitute(value) {
	if (typeof value === "string") return value.replaceAll("{{SHELL_RC}}", shellRc());
	return value;
}

function mergeFile(name, defaultsFile) {
	const defaults = readJson(join(REPO_ROOT, "config", defaultsFile), undefined);
	if (!defaults) {
		warn(`Missing config/${defaultsFile} - skipping ${name}`);
		return;
	}

	const target = join(AGENT_DIR, name);
	const current = readJson(target, {});
	const merged = { ...current };

	const added = [];
	const kept = [];
	const replaced = [];

	for (const [key, rawValue] of Object.entries(defaults)) {
		const value = substitute(rawValue);
		const existing = current[key];
		if (existing === undefined) {
			merged[key] = value;
			added.push(key);
		} else if (JSON.stringify(existing) === JSON.stringify(value)) {
			// Already matches; nothing to do.
		} else if (force) {
			merged[key] = value;
			replaced.push(key);
		} else {
			kept.push(key);
		}
	}

	if (added.length || replaced.length) {
		if (!dryRun) {
			mkdirSync(AGENT_DIR, { recursive: true });
			writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
		}
		if (added.length) info(`${name}: set ${added.join(", ")}`);
		if (replaced.length) info(`${name}: overwrote ${replaced.join(", ")}`);
	} else {
		info(`${name}: nothing to change`);
	}

	if (kept.length) {
		warn(`${name}: kept your values for ${kept.join(", ")} (use --force to apply Yarrow's)`);
	}
}

if (dryRun) info("Dry run - no files will be written");
info(`Applying Yarrow config to ${AGENT_DIR}`);
mergeFile("settings.json", "settings.defaults.json");
mergeFile("keybindings.json", "keybindings.defaults.json");
