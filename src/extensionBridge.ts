import { Platform } from "obsidian";
import type { IncomingMessage, Server, ServerResponse } from "http";
import type { JobApplication } from "./types";

/** Port the browser extension asks on. Keep in sync with VAULT_PORT in browser-extension/background.js. */
export const EXTENSION_BRIDGE_PORT = 27125;

const TRACKING_PARAM = /^(utm_\w+|gh_src|source|src|ref|referrer|refid|trk|trackingid|lipi|origin|share_id|iis|iisn)$/i;

/** Normalizes a job URL so tracking params, "www.", hashes and trailing slashes don't hide a match. */
export function normalizeJobUrl(raw: string): string {
	try {
		const url = new URL(raw.trim());
		for (const name of [...url.searchParams.keys()]) {
			if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
		}
		url.hash = "";
		const host = url.hostname.toLowerCase().replace(/^www\./, "");
		return `${host}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
	} catch {
		return "";
	}
}

/** Greenhouse shows one job on several URLs (job-boards, boards, embeds, company sites with ?gh_jid=); its numeric id is stable. */
export function greenhouseJobId(raw: string): string {
	try {
		const url = new URL(raw.trim());
		const ghJid = url.searchParams.get("gh_jid");
		if (ghJid && /^\d+$/.test(ghJid)) return ghJid;
		if (!/(^|\.)greenhouse\.io$/i.test(url.hostname)) return "";
		const token = url.searchParams.get("token");
		if (token && /^\d+$/.test(token)) return token;
		return /\/jobs\/(\d+)/.exec(url.pathname)?.[1] ?? "";
	} catch {
		return "";
	}
}

export function normalizeName(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

export interface TrackedMatch {
	company: string;
	role: string;
	status: string;
	filePath: string;
}

/** Finds an application in the vault that is the same job: same posting URL, same Greenhouse id, or same company and role. */
export function findTrackedApplication(
	applications: JobApplication[],
	query: { url?: string; company?: string; role?: string }
): TrackedMatch | null {
	const url = query.url ? normalizeJobUrl(query.url) : "";
	const ghId = query.url ? greenhouseJobId(query.url) : "";
	const company = normalizeName(query.company ?? "");
	const role = normalizeName(query.role ?? "");

	const match = applications.find((app) => {
		if (app.jobUrl) {
			if (url && normalizeJobUrl(app.jobUrl) === url) return true;
			if (ghId && greenhouseJobId(app.jobUrl) === ghId) return true;
		}
		return Boolean(company && role && normalizeName(app.company) === company && normalizeName(app.role) === role);
	});
	return match ? { company: match.company, role: match.role, status: match.status, filePath: match.filePath } : null;
}

/**
 * Tiny localhost server so the browser extension can ask "is this job already tracked?" before offering to parse it.
 * Desktop only, bound to 127.0.0.1, and it only answers browser-extension origins, so web pages can't probe the vault.
 */
export class ExtensionBridge {
	private server: Server | null = null;

	constructor(private getApplications: () => JobApplication[]) {}

	start(): void {
		if (this.server || !Platform.isDesktopApp) return;
		let http: typeof import("http");
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			http = require("http");
		} catch {
			return;
		}
		const server = http.createServer((req, res) => this.handle(req, res));
		server.on("error", (error: NodeJS.ErrnoException) => {
			// Another vault (or app) already owns the port; the extension will talk to that one.
			if (error.code !== "EADDRINUSE") console.error("Job Tracker: extension bridge failed", error);
			this.server = null;
		});
		server.listen(EXTENSION_BRIDGE_PORT, "127.0.0.1");
		this.server = server;
	}

	stop(): void {
		this.server?.close();
		this.server = null;
	}

	private handle(req: IncomingMessage, res: ServerResponse): void {
		const origin = String(req.headers.origin ?? "");
		if (!/^(chrome|moz|safari-web)-extension:\/\//.test(origin)) {
			res.writeHead(403).end();
			return;
		}
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method !== "GET" || url.pathname !== "/lookup") {
			res.writeHead(404).end();
			return;
		}
		const param = (key: string, max: number) => (url.searchParams.get(key) ?? "").slice(0, max);
		const match = findTrackedApplication(this.getApplications(), {
			url: param("url", 1000),
			company: param("company", 200),
			role: param("role", 300),
		});
		res.writeHead(200, {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": origin,
			"Cache-Control": "no-store",
		});
		res.end(JSON.stringify(match ? { tracked: true, ...match } : { tracked: false }));
	}
}
