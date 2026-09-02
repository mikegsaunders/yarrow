import { describe, expect, test } from "bun:test";
import { readAuthEntry } from "./auth.ts";

describe("auth.json credentials", () => {
	test("api_key entries", () => {
		expect(readAuthEntry({ type: "api_key", key: "sk-literal" })).toBe("sk-literal");
	});

	test("an api_key entry naming an environment variable", () => {
		process.env.YARROW_TEST_KEY = "sk-from-env";
		expect(readAuthEntry({ type: "api_key", key: "YARROW_TEST_KEY" })).toBe("sk-from-env");
		delete process.env.YARROW_TEST_KEY;
	});

	test("oauth entries, which is what /login openrouter writes", () => {
		expect(
			readAuthEntry({ type: "oauth", access: "sk-from-oauth", expires: Number.MAX_SAFE_INTEGER }),
		).toBe("sk-from-oauth");
	});

	test("an expired oauth token is absent, not sent", () => {
		expect(readAuthEntry({ type: "oauth", access: "stale", expires: Date.now() - 1000 })).toBeUndefined();
	});

	test("unsupported and missing shapes", () => {
		expect(readAuthEntry({ type: "api_key", key: "!op read op://vault/key" })).toBeUndefined();
		expect(readAuthEntry({ type: "api_key" })).toBeUndefined();
		expect(readAuthEntry(undefined)).toBeUndefined();
	});
});
