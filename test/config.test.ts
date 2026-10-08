import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ConfigWatcher, configPath, loadConfig, validateConfig } from "../config.ts";

function tempConfig(content: string): string {
	const dir = mkdtempSync(path.join(tmpdir(), "pi-llm-proxy-"));
	const file = path.join(dir, "llm-proxy.json");
	writeFileSync(file, content);
	return file;
}

describe("validateConfig", () => {
	it("fills defaults for missing fields", () => {
		const config = validateConfig({ proxy: "http://p:1" });
		assert.deepEqual(config, {
			proxy: "http://p:1",
			providers: ["openai-codex"],
			hosts: [],
		});
	});

	it("rejects non-object values", () => {
		assert.throws(() => validateConfig([]), /must be a JSON object/);
		assert.throws(() => validateConfig(null), /must be a JSON object/);
	});

	it("rejects wrong field types", () => {
		assert.throws(() => validateConfig({ proxy: 5 }), /proxy must be a string/);
		assert.throws(() => validateConfig({ providers: "codex" }), /providers must be an array/);
		assert.throws(() => validateConfig({ hosts: [1] }), /hosts must be an array/);
	});
});

describe("loadConfig", () => {
	it("parses a full config file", () => {
		const config = loadConfig(
			tempConfig(JSON.stringify({ proxy: "http://127.0.0.1:7897", providers: ["csdn"], hosts: ["example.com"] })),
		);
		assert.equal(config.proxy, "http://127.0.0.1:7897");
		assert.deepEqual(config.providers, ["csdn"]);
		assert.deepEqual(config.hosts, ["example.com"]);
	});

	it("throws on invalid JSON", () => {
		assert.throws(() => loadConfig(tempConfig("{oops")));
	});
});

describe("ConfigWatcher", () => {
	it("hot-reloads when the file changes", () => {
		const file = tempConfig(JSON.stringify({ proxy: "http://first:1", providers: ["csdn"] }));
		const watcher = new ConfigWatcher(file);
		assert.equal(watcher.get().proxy, "http://first:1");

		// Rewrite with a newer mtime, as an editor would.
		const later = new Date(Date.now() + 5000);
		writeFileSync(file, JSON.stringify({ proxy: "http://second:2", providers: ["csdn"] }));
		utimesSync(file, later, later);
		assert.equal(watcher.get().proxy, "http://second:2");
	});

	it("falls back to defaults when the file is missing", () => {
		const watcher = new ConfigWatcher(path.join(tmpdir(), "pi-llm-proxy-missing.json"));
		assert.deepEqual(watcher.get(), {
			proxy: "http://127.0.0.1:7897",
			providers: ["openai-codex"],
			hosts: [],
		});
	});

	it("keeps serving the previous config on an invalid edit", () => {
		const file = tempConfig(JSON.stringify({ proxy: "http://good:1" }));
		const watcher = new ConfigWatcher(file);
		assert.equal(watcher.get().proxy, "http://good:1");

		const later = new Date(Date.now() + 5000);
		writeFileSync(file, "{broken");
		utimesSync(file, later, later);
		assert.equal(watcher.get().proxy, "http://good:1");
	});
});

describe("configPath", () => {
	it("honours PI_LLM_PROXY_CONFIG", () => {
		assert.equal(configPath({ PI_LLM_PROXY_CONFIG: "/x/y.json" }), "/x/y.json");
	});

	it("defaults to ~/.pi/agent/llm-proxy.json", () => {
		const resolved = configPath({});
		assert.match(resolved, /\.pi[/\\]agent[/\\]llm-proxy\.json$/);
	});
});
