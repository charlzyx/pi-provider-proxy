/**
 * Configuration for pi-llm-proxy.
 *
 * Loaded from `~/.pi/agent/llm-proxy.json` (or the file named by
 * `PI_LLM_PROXY_CONFIG`). The file is re-read whenever its mtime changes, so
 * edits hot-reload without restarting Pi.
 */

import { statSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProxyConfig {
	/** One HTTP proxy URL, e.g. http://127.0.0.1:7897 */
	proxy: string;
	/** Provider names whose traffic goes through the proxy. */
	providers: string[];
	/** Extra request hosts (hostnames) to proxy, in addition to providers. */
	hosts: string[];
}

const DEFAULT_CONFIG: ProxyConfig = {
	proxy: "http://127.0.0.1:7897",
	providers: ["openai-codex"],
	hosts: [],
};

/** Where the config file lives: $PI_LLM_PROXY_CONFIG, else the agent dir. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.PI_LLM_PROXY_CONFIG;
	if (override) return override;
	return path.join(os.homedir(), ".pi", "agent", "llm-proxy.json");
}

/** Validate one parsed config object; throws with a readable message. */
export function validateConfig(value: unknown): ProxyConfig {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("pi-llm-proxy: config must be a JSON object");
	}
	const raw = value as Record<string, unknown>;
	if (raw.proxy !== undefined && typeof raw.proxy !== "string") {
		throw new Error("pi-llm-proxy: config.proxy must be a string");
	}
	const providers = raw.providers ?? DEFAULT_CONFIG.providers;
	const hosts = raw.hosts ?? DEFAULT_CONFIG.hosts;
	if (!Array.isArray(providers) || providers.some((p) => typeof p !== "string")) {
		throw new Error("pi-llm-proxy: config.providers must be an array of strings");
	}
	if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== "string")) {
		throw new Error("pi-llm-proxy: config.hosts must be an array of strings");
	}
	return {
		proxy: raw.proxy ?? DEFAULT_CONFIG.proxy,
		providers: providers as string[],
		hosts: hosts as string[],
	};
}

/** Synchronous one-shot read; throws when the file is missing or invalid. */
export function loadConfig(file: string): ProxyConfig {
	return validateConfig(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * Hot-reloading config reader: caches the parsed config and re-reads when the
 * file's mtime or size changes. Each check is one stat; the read itself only
 * happens on change.
 */
export class ConfigWatcher {
	#file: string;
	#cache: ProxyConfig | undefined;
	#mtime = 0;
	#size = 0;

	constructor(file: string) {
		this.#file = file;
	}

	/** The current config, re-reading the file when it changed on disk. */
	get(): ProxyConfig {
		let stats;
		try {
			stats = statSync(this.#file);
		} catch {
			// No config file: fall back to defaults rather than failing requests.
			this.#cache = undefined;
			this.#mtime = 0;
			this.#size = 0;
			return DEFAULT_CONFIG;
		}
		if (this.#cache && stats.mtimeMs === this.#mtime && stats.size === this.#size) {
			return this.#cache;
		}
		try {
			const config = loadConfig(this.#file);
			this.#cache = config;
			this.#mtime = stats.mtimeMs;
			this.#size = stats.size;
			return config;
		} catch (error) {
			// Invalid edit: keep serving the previous config until it is fixed.
			if (this.#cache) return this.#cache;
			throw error;
		}
	}
}
