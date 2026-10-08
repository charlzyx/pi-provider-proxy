/**
 * pi-provider-proxy — per-provider HTTP proxy for the Pi coding agent, ported from
 * dshwork/packages/llm-provider-proxy.
 *
 * Owns the whole transport-proxy layer: a zero-dependency HTTP CONNECT tunnel
 * (Node's global fetch ignores `http_proxy`/`https_proxy` env vars, and some
 * provider endpoints are region-blocked), plus a global fetch wrapper that
 * routes each request through the configured proxy when its host belongs to a
 * configured provider. Only listed providers are proxied; everything else
 * passes through untouched — this is not a global proxy. Loopback hosts are
 * never proxied, so local gateways keep working.
 *
 * Config (hot-reloadable, `~/.pi/agent/provider-proxy.json`, or the file named by
 * `PI_PROVIDER_PROXY_CONFIG`):
 *
 * ```json
 * {
 *   "proxy": "http://127.0.0.1:7897",
 *   "providers": ["openai-codex"],
 *   "hosts": []
 * }
 * ```
 *
 * Install: symlink this repo into Pi's extension directory, e.g.
 * `ln -s /Users/you/github/pi-provider-proxy ~/.pi/agent/extensions/pi-provider-proxy`, or
 * add `src`-style entry to `extensions` in settings.json — the repo root is the
 * extension: `index.ts` entry plus sibling modules.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ConfigWatcher, configPath } from "./config.ts";
import { buildHostIndex, modelsJsonHosts } from "./routing.ts";
import { isLoopbackHost, parseProxyUrl, proxiedFetch } from "./proxy.ts";

/** State of the installed wrapper, shared by the command handler. */
interface WrapperState {
	/** Hostname of the request being inspected right now (for /provider-proxy). */
	originalFetch: typeof globalThis.fetch;
	/** Number of requests routed through the proxy since install. */
	proxiedCount: number;
	/** Number of requests passed through untouched since install. */
	passthroughCount: number;
}

/** Install the global fetch wrapper. Returns the state it updates. Idempotent:
 * calling twice replaces the first wrapper with an equivalent one. */
export function installFetchWrapper(
	watcher: ConfigWatcher,
	customHosts: Map<string, string[]> = modelsJsonHosts(),
	state?: WrapperState,
): WrapperState {
	const st: WrapperState = state ?? {
		originalFetch: globalThis.fetch,
		proxiedCount: 0,
		passthroughCount: 0,
	};
	globalThis.fetch = (input, init) => {
		let hostname = "";
		try {
			const url =
				input instanceof URL ? input : new URL(String((input as Request).url ?? input));
			hostname = url.hostname;
		} catch {
			return st.originalFetch(input, init);
		}
		if (isLoopbackHost(hostname)) return st.originalFetch(input, init);
		const proxy = parseProxyUrl(watcher.get().proxy);
		if (!proxy) return st.originalFetch(input, init);
		if (buildHostIndex(watcher.get(), customHosts).get(hostname.toLowerCase())) {
			st.proxiedCount += 1;
			return proxiedFetch(input, init, proxy);
		}
		st.passthroughCount += 1;
		return st.originalFetch(input, init);
	};
	return st;
}

export default function llmProxy(pi: ExtensionAPI): void {
	const watcher = new ConfigWatcher(configPath());
	const customHosts = modelsJsonHosts();
	const state = installFetchWrapper(watcher, customHosts);

	pi.registerCommand("provider-proxy", {
		description: "Show pi-provider-proxy routing status",
		handler: async (_args, ctx) => {
			const config = watcher.get();
			const index = buildHostIndex(config, customHosts);
			const lines = [
				`pi-provider-proxy: proxy ${config.proxy || "(not configured)"}`,
				`providers: ${config.providers.join(", ") || "(none)"}`,
				`hosts: ${[...index.keys()].sort().join(", ") || "(none)"}`,
				`requests: ${state.proxiedCount} proxied, ${state.passthroughCount} passthrough`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
