import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readAuthEntry } from "./auth.ts";

describe("auth.json credentials", () => {
	test("api_key entries", () => {
		assert.equal(readAuthEntry({ type: "api_key", key: "sk-literal" }), "sk-literal");
	});

	test("an api_key entry naming an environment variable", () => {
		process.env.YARROW_TEST_KEY = "sk-from-env";
		assert.equal(readAuthEntry({ type: "api_key", key: "YARROW_TEST_KEY" }), "sk-from-env");
		delete process.env.YARROW_TEST_KEY;
	});

	test("oauth entries, which is what /login openrouter writes", () => {
		assert.equal(
			readAuthEntry({ type: "oauth", access: "sk-from-oauth", expires: Number.MAX_SAFE_INTEGER }),
			"sk-from-oauth",
		);
	});

	test("an expired oauth token is absent, not sent", () => {
		assert.equal(readAuthEntry({ type: "oauth", access: "stale", expires: Date.now() - 1000 }), undefined);
	});

	test("unsupported and missing shapes", () => {
		assert.equal(readAuthEntry({ type: "api_key", key: "!op read op://vault/key" }), undefined);
		assert.equal(readAuthEntry({ type: "api_key" }), undefined);
		assert.equal(readAuthEntry(undefined), undefined);
	});
});
