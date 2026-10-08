/**
 * Zero-dependency HTTP CONNECT tunnel plus a fetch-compatible transport,
 * ported from dshwork/packages/provider-proxy.
 *
 * Node's global fetch ignores `http_proxy` / `https_proxy` env vars, and some
 * provider endpoints are region-blocked: requests whose host belongs to a
 * configured provider are tunneled through the configured HTTP proxy via
 * CONNECT; everything else passes through untouched.
 */

import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { Readable } from "node:stream";
import type { Duplex } from "node:stream";

/** Parse and validate one proxy URL value; undefined when empty. */
export function parseProxyUrl(value: unknown): URL | undefined {
	if (value === undefined || value === null) return undefined;
	const text = String(value).trim();
	if (!text) return undefined;
	const url = new URL(text);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(
			`pi-provider-proxy: unsupported proxy scheme "${url.protocol}" in "${text}"; use an HTTP proxy (e.g. Clash/ClashX)`,
		);
	}
	return url;
}

/** Loopback hosts are never proxied: that would intercept the process's own
 * local traffic (local gateways like magpie/combo must pass through). */
export function isLoopbackHost(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "[::1]" ||
		hostname === "::1" ||
		/^127(?:\.\d{1,3}){3}$/.test(hostname)
	);
}

/** The real platform fetch captured at module load, so wrapper fallbacks never
 * recurse into another wrapper installed later. */
const NATIVE_FETCH = globalThis.fetch;

/** Normalize any fetch input to a URL object. */
function urlOf(input: Parameters<typeof fetch>[0]): URL {
	if (input instanceof URL) return input;
	if (typeof input === "string") return new URL(input);
	if (input instanceof Request) return new URL(input.url);
	return new URL(String(input));
}

class ConnectProxyAgent extends https.Agent {
	proxy: URL;
	constructor(proxy: URL) {
		super();
		this.proxy = proxy;
	}
	override createConnection(
		options: https.RequestOptions,
		callback?: (error: Error | null, stream: Duplex) => void,
	): Duplex | null | undefined {
		const proxy = this.proxy;
		const connectHost = String(options.host ?? "");
		const connectPort = options.port ?? 443;
		const onCallback: (error: Error | null, stream?: Duplex) => void = (error, stream) => {
			callback?.(error, stream as Duplex);
		};
		const connectPath = `${connectHost}:${connectPort}`;
		const headers: Record<string, string> = {
			Host: connectPath,
			"Proxy-Connection": "keep-alive",
		};
		if (proxy.username || proxy.password) {
			const credentials = Buffer.from(
				`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
			).toString("base64");
			headers["Proxy-Authorization"] = `Basic ${credentials}`;
		}
		const request = http.request({
			host: proxy.hostname,
			port: Number(proxy.port) || 80,
			method: "CONNECT",
			path: connectPath,
			headers,
		});
		request.on("connect", (response, socket) => {
			if (response.statusCode !== 200) {
				socket.destroy();
				onCallback(
					new Error(
						`proxy CONNECT failed: ${response.statusCode} ${response.statusMessage ?? ""}`,
					),
				);
				return;
			}
			const tlsSocket = tls.connect({ socket, servername: connectHost });
			tlsSocket.once("secureConnect", () => onCallback(null, tlsSocket));
			tlsSocket.once("error", (error) => onCallback(error));
		});
		request.on("error", (error) => onCallback(error));
		request.end();
		// The connection is delivered asynchronously through the callback.
		return null;
	}
}

/** Collect a fetch body into a Buffer for the raw https request. */
async function readBody(
	body: BodyInit | null | undefined,
): Promise<Buffer | undefined> {
	if (body === undefined || body === null) return undefined;
	if (typeof body === "string") return Buffer.from(body);
	if (body instanceof Uint8Array) return Buffer.from(body);
	if (body instanceof ArrayBuffer) return Buffer.from(body);
	if (typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
		const chunks: Buffer[] = [];
		for await (const chunk of body as AsyncIterable<unknown>) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	}
	return Buffer.from(String(body));
}

/**
 * fetch-compatible transport that routes through an HTTP proxy. Falls back to
 * the native fetch when no proxy applies (none configured, non-https target,
 * or loopback host).
 */
export async function proxiedFetch(
	input: Parameters<typeof fetch>[0],
	init: RequestInit = {},
	explicitProxy?: unknown,
): Promise<Response> {
	const proxy = explicitProxy !== undefined ? parseProxyUrl(explicitProxy) : undefined;
	const url = urlOf(input);
	if (!proxy || url.protocol !== "https:" || isLoopbackHost(url.hostname)) {
		return NATIVE_FETCH(input, init);
	}
	const method = init.method ?? "GET";
	const headers = new Headers(init.headers);
	const plainHeaders: Record<string, string> = {};
	for (const [name, value] of headers.entries()) plainHeaders[name] = value;
	const bodyBuffer = await readBody(init.body);
	const agent = new ConnectProxyAgent(proxy);
	const response = await new Promise<Response>((resolve, reject) => {
		const request = https.request(
			{
				host: url.hostname,
				port: Number(url.port) || 443,
				path: `${url.pathname}${url.search}`,
				method,
				headers: {
					...plainHeaders,
					...(bodyBuffer !== undefined
						? { "Content-Length": String(bodyBuffer.byteLength) }
						: {}),
				},
				agent,
				signal: init.signal ?? undefined,
			},
			(res) => {
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(res.headers)) {
					if (value === undefined) continue;
					if (Array.isArray(value)) {
						for (const item of value) responseHeaders.append(name, item);
					} else {
						responseHeaders.set(name, value);
					}
				}
				resolve(
					new Response(Readable.toWeb(res) as ReadableStream, {
						status: res.statusCode ?? 200,
						statusText: res.statusMessage,
						headers: responseHeaders,
					}),
				);
			},
		);
		request.on("error", (error) => reject(error));
		if (bodyBuffer !== undefined) request.write(bodyBuffer);
		request.end();
	});
	return response;
}
