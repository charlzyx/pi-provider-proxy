/**
 * Host routing: resolve which request hosts belong to a configured provider.
 *
 * Two sources feed the table:
 * - A built-in table mirroring pi-ai's provider data (request + OAuth hosts).
 * - `~/.pi/agent/models.json` custom providers: each entry's `baseUrl` host is
 *   attributed to the provider key, covering self-hosted gateways. Loopback
 *   hosts are dropped (they are never proxied).
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLoopbackHost } from "./proxy.ts";

/** Known provider → request and OAuth hosts, mirroring pi-ai's provider data. */
export const BUILTIN_HOSTS: Record<string, string[]> = {
	"openai-codex": ["chatgpt.com", "auth.openai.com"],
	openai: ["api.openai.com", "auth.openai.com"],
	anthropic: ["api.anthropic.com", "console.anthropic.com"],
	csdn: ["ai.csdn.net"],
	"deepseek-official": ["api.deepseek.com"],
	deepseek: ["api.deepseek.com"],
	google: ["generativelanguage.googleapis.com", "oauth2.googleapis.com"],
	"google-vertex": ["aiplatform.googleapis.com"],
	openrouter: ["openrouter.ai"],
	"github-copilot": ["api.individual.githubcopilot.com", "github.com", "githubusercontent.com"],
	groq: ["api.groq.com"],
	moonshotai: ["api.moonshot.ai"],
	"moonshotai-cn": ["api.moonshot.cn"],
	"kimi-coding": ["api.kimi.com"],
	zai: ["api.z.ai"],
	"zai-coding-cn": ["open.bigmodel.cn"],
	xai: ["api.x.ai"],
	minimax: ["api.minimax.io"],
	"minimax-cn": ["api.minimaxi.com"],
	mistral: ["api.mistral.ai"],
	cerebras: ["api.cerebras.ai"],
	fireworks: ["api.fireworks.ai"],
	together: ["api.together.ai"],
	nvidia: ["integrate.api.nvidia.com"],
	baseten: ["inference.baseten.co"],
	huggingface: ["router.huggingface.co"],
	"cloudflare-workers-ai": ["api.cloudflare.com"],
	"cloudflare-ai-gateway": ["gateway.ai.cloudflare.com"],
	"vercel-ai-gateway": ["ai-gateway.vercel.sh"],
	xiaomi: ["api.xiaomimimo.com"],
	"ant-ling": ["api.ant-ling.com"],
	opencode: ["opencode.ai"],
};

/** One provider entry from models.json worth reading. */
interface ModelsJsonProvider {
	baseUrl?: unknown;
}

/** Read custom providers' baseUrl hosts from the agent's models.json. Missing
 * or malformed files yield an empty map: the extension must never break Pi. */
export function modelsJsonHosts(
	file = path.join(os.homedir(), ".pi", "agent", "models.json"),
): Map<string, string[]> {
	const out = new Map<string, string[]>();
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return out;
	}
	const providers = (parsed as { providers?: Record<string, ModelsJsonProvider> }).providers;
	if (!providers || typeof providers !== "object") return out;
	for (const [name, entry] of Object.entries(providers)) {
		const baseUrl = entry?.baseUrl;
		if (typeof baseUrl !== "string" || !baseUrl) continue;
		try {
			const host = new URL(baseUrl).hostname;
			if (host) out.set(name, [host]);
		} catch {
			// Unparseable baseUrl — ignore this entry.
		}
	}
	return out;
}

/**
 * Build the host → proxy index for the current config. Later sources win for
 * duplicate hosts in this order: built-in table, models.json, config.hosts.
 */
export function buildHostIndex(config: {
	proxy: string;
	providers: string[];
	hosts: string[];
}, customHosts: Map<string, string[]> = modelsJsonHosts()): Map<string, string> {
	const index = new Map<string, string>();
	const assign = (host: string) => {
		const hostname = host.replace(/^\[|\]$/g, "").toLowerCase();
		if (!hostname || isLoopbackHost(hostname)) return;
		index.set(hostname, config.proxy);
	};
	for (const provider of config.providers) {
		for (const host of BUILTIN_HOSTS[provider] ?? []) assign(host);
		for (const host of customHosts.get(provider) ?? []) assign(host);
	}
	for (const host of config.hosts) assign(host);
	return index;
}
