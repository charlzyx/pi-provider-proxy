import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHostIndex, BUILTIN_HOSTS, modelsJsonHosts } from "../routing.ts";

describe("buildHostIndex", () => {
	it("maps builtin provider hosts to the proxy", () => {
		const index = buildHostIndex({
			proxy: "http://127.0.0.1:7897",
			providers: ["openai-codex"],
			hosts: [],
		}, new Map());
		assert.equal(index.get("chatgpt.com"), "http://127.0.0.1:7897");
		assert.equal(index.get("auth.openai.com"), "http://127.0.0.1:7897");
		assert.equal(index.has("api.anthropic.com"), false);
	});

	it("adds models.json custom provider hosts", () => {
		const custom = new Map([["csdn", ["ai.csdn.net"]]]);
		const index = buildHostIndex(
			{ proxy: "http://p:1", providers: ["csdn"], hosts: [] },
			custom,
		);
		assert.equal(index.get("ai.csdn.net"), "http://p:1");
	});

	it("drops loopback hosts from custom providers", () => {
		const custom = new Map([["magpie", ["127.0.0.1"]], ["combo", ["localhost"]]]);
		const index = buildHostIndex(
			{ proxy: "http://p:1", providers: ["magpie", "combo"], hosts: [] },
			custom,
		);
		assert.equal(index.size, 0);
	});

	it("explicit config.hosts win and loopback entries there are dropped", () => {
		const index = buildHostIndex(
			{ proxy: "http://p:1", providers: [], hosts: ["example.com", "127.0.0.1"] },
			new Map(),
		);
		assert.deepEqual([...index.keys()], ["example.com"]);
	});

	it("unknown providers contribute no hosts", () => {
		const index = buildHostIndex(
			{ proxy: "http://p:1", providers: ["not-a-provider"], hosts: [] },
			new Map(),
		);
		assert.equal(index.size, 0);
	});
});

describe("BUILTIN_HOSTS", () => {
	it("covers the providers this machine uses", () => {
		assert.ok(BUILTIN_HOSTS["openai-codex"].includes("chatgpt.com"));
		assert.ok(BUILTIN_HOSTS.csdn.includes("ai.csdn.net"));
		assert.ok(BUILTIN_HOSTS["deepseek-official"].includes("api.deepseek.com"));
	});
});

describe("modelsJsonHosts", () => {
	it("reads this machine's models.json and skips loopback later", () => {
		const hosts = modelsJsonHosts();
		// Present on this machine; the test only asserts shape.
		for (const [provider, list] of hosts) {
			assert.equal(typeof provider, "string");
			assert.ok(list.every((host) => typeof host === "string" && host.length > 0));
		}
	});
});
