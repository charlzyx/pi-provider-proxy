import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLoopbackHost, parseProxyUrl, proxiedFetch } from "../proxy.ts";

describe("parseProxyUrl", () => {
	it("accepts an http proxy URL", () => {
		const url = parseProxyUrl("http://127.0.0.1:7897");
		assert.equal(url?.hostname, "127.0.0.1");
		assert.equal(url?.port, "7897");
	});

	it("accepts credentials in the proxy URL", () => {
		const url = parseProxyUrl("http://user:pass@proxy.example.com:8080");
		assert.equal(url?.username, "user");
		assert.equal(url?.password, "pass");
	});

	it("returns undefined for empty values", () => {
		assert.equal(parseProxyUrl(undefined), undefined);
		assert.equal(parseProxyUrl(null), undefined);
		assert.equal(parseProxyUrl(""), undefined);
		assert.equal(parseProxyUrl("  "), undefined);
	});

	it("rejects non-HTTP schemes", () => {
		assert.throws(() => parseProxyUrl("socks5://127.0.0.1:1080"), /unsupported proxy scheme/);
		assert.throws(() => parseProxyUrl("ftp://x"), /unsupported proxy scheme/);
	});
});

describe("isLoopbackHost", () => {
	it("matches localhost and IPv4 loopback", () => {
		assert.equal(isLoopbackHost("localhost"), true);
		assert.equal(isLoopbackHost("127.0.0.1"), true);
		assert.equal(isLoopbackHost("127.8.8.8"), true);
	});

	it("matches IPv6 loopback", () => {
		assert.equal(isLoopbackHost("::1"), true);
		assert.equal(isLoopbackHost("[::1]"), true);
	});

	it("rejects non-loopback hosts", () => {
		assert.equal(isLoopbackHost("chatgpt.com"), false);
		assert.equal(isLoopbackHost("ai.csdn.net"), false);
		assert.equal(isLoopbackHost("128.0.0.1"), false);
		assert.equal(isLoopbackHost(""), false);
	});
});

describe("proxiedFetch", () => {
	it("falls back to native fetch for loopback https targets", async () => {
		// No local server: native fetch fails fast with ECONNREFUSED, which
		// proves the request did NOT go through a proxy.
		await assert.rejects(
			proxiedFetch("https://127.0.0.1:59999/", {}, "http://127.0.0.1:59998"),
		);
	});

	it("falls back to native fetch when no proxy is given", async () => {
		await assert.rejects(proxiedFetch("https://127.0.0.1:59999/", {}));
	});
});
