(() => {
	const URI_ACTION = "swe-job-tracker-add";
	const JD_MAX = 10000;
	// Jobs the user dismissed ("Skip this job" / x) or sent to Obsidian. The vault is the main check; these lists cover
	// dismissals and the times Obsidian isn't running to ask.
	const DISMISSED_KEY = "parsePromptDismissed";
	const SENT_KEY = "parsePromptSent";
	const LEGACY_SEEN_KEY = "parsePromptSeen";
	const LIST_MAX = 2000;
	const TRACKING_PARAM = /^(utm_\w+|gh_src|source|src|ref|referrer|refid|trk|trackingid|lipi|origin|share_id|iis|iisn)$/i;

	const EMPLOYMENT_MAP = {
		FULL_TIME: "Full-time",
		PART_TIME: "Part-time",
		CONTRACTOR: "Contract",
		TEMPORARY: "Contract",
		INTERN: "Internship",
	};

	// ATS pages that are job postings even without schema.org markup (LinkedIn/Indeed have their own scrapers).
	const KNOWN_JOB_URL = [
		/greenhouse\.io\/.+\/jobs\/\d+/,
		/jobs\.lever\.co\/[^/]+\/[0-9a-f-]{36}/,
		/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}/,
		/myworkdayjobs\.com\/.+\/job\//,
		/[?&]gh_jid=\d+/,
		/tesla\.com\/(?:[a-z]{2}_[a-z]{2}\/)?careers\/search\/job\//i,
		/\/careers?\/(?:.+\/)?jobs?\/[^/?#]*\d{4,}/i,
	];

	const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
	const first = (...selectors) => {
		for (const sel of selectors) {
			const el = document.querySelector(sel);
			if (text(el)) return el;
		}
		return null;
	};
	const meta = (prop) =>
		document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.getAttribute("content")?.trim() ?? "";

	// ---------- HTML → readable plain text ----------

	function htmlToText(html) {
		let doc = new DOMParser().parseFromString(html, "text/html");
		// Some ATSs (e.g. Greenhouse) entity-encode the HTML inside JSON-LD, so decode twice.
		if (/<\/?[a-z][\s\S]*>/i.test(doc.body.textContent) && !doc.body.querySelector("*")) {
			doc = new DOMParser().parseFromString(doc.body.textContent, "text/html");
		}
		return elementToText(doc.body);
	}

	function elementToText(root) {
		const clone = root.cloneNode(true);
		clone.querySelectorAll("script, style, button, svg").forEach((el) => el.remove());
		clone.querySelectorAll("li").forEach((li) => li.prepend("- "));
		clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
		clone.querySelectorAll("p, div, li, ul, ol, h1, h2, h3, h4, h5, h6, section").forEach((el) => {
			el.append("\n");
		});
		return clone.textContent
			.replace(/[ \t ]+/g, " ")
			.replace(/ *\n */g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim();
	}

	// ---------- schema.org JobPosting (Greenhouse, Lever, Ashby, Workday, many career sites) ----------

	function findJobPosting() {
		for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
			let data;
			try {
				data = JSON.parse(script.textContent);
			} catch {
				continue;
			}
			const stack = [data];
			while (stack.length) {
				const node = stack.pop();
				if (!node || typeof node !== "object") continue;
				if (Array.isArray(node)) {
					stack.push(...node);
					continue;
				}
				const type = node["@type"];
				if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return node;
				if (node["@graph"]) stack.push(node["@graph"]);
			}
		}
		return null;
	}

	function formatLocation(posting) {
		const places = [].concat(posting.jobLocation ?? []).map((loc) => {
			const addr = loc?.address ?? {};
			if (typeof addr === "string") return addr;
			const country = typeof addr.addressCountry === "object" ? addr.addressCountry?.name : addr.addressCountry;
			return [addr.addressLocality, addr.addressRegion || country].filter(Boolean).join(", ");
		});
		const remote = [].concat(posting.jobLocationType ?? []).includes("TELECOMMUTE");
		const unique = [...new Set(places.filter(Boolean))];
		if (remote) {
			const regions = [].concat(posting.applicantLocationRequirements ?? [])
				.map((r) => (typeof r === "string" ? r : r?.name))
				.filter(Boolean);
			unique.push(regions.length ? `Remote (${regions.join(", ")})` : "Remote");
		}
		return unique.join(" / ");
	}

	function fromJobPosting(posting) {
		const org = posting.hiringOrganization;
		return {
			company: typeof org === "string" ? org : org?.name ?? "",
			role: posting.title ?? "",
			location: formatLocation(posting),
			employmentType: [].concat(posting.employmentType ?? []).map((t) => EMPLOYMENT_MAP[t]).find(Boolean) ?? "",
			salaryRanges: JobCompParser.rangesFromJsonLd(posting),
			jobDescription: posting.description ? htmlToText(posting.description) : "",
		};
	}

	// Pay often sits in its own block outside the description (Greenhouse/Ashby pay transparency, LinkedIn/Indeed chips).
	const PAY_BLOCKS = '[class*="pay-range" i], [class*="pay-transparency" i], [class*="salary" i], [class*="compensation" i], [data-testid*="salary" i]';
	// Other jobs' cards (search results, "similar jobs") also show salaries; ignore those.
	const OTHER_JOBS = '[class*="job-card" i], [class*="jobs-search-results" i], [class*="scaffold-layout__list" i], [class*="similar" i], [class*="recommend" i], [class*="related" i]';

	function pagePayText() {
		const picked = [];
		for (const el of document.querySelectorAll(PAY_BLOCKS)) {
			if (el.closest(OTHER_JOBS) || picked.some((p) => p.contains(el))) continue;
			picked.push(el);
		}
		return picked.map(elementToText).filter((t) => t && t.length < 4000).join("\n");
	}

	/** Fills salary with every listed range (lowest to highest per pay period) and adds every location mentioned. */
	function addPayAndLocations(job, extraText) {
		const text = [job.jobDescription, extraText, pagePayText()].filter(Boolean).join("\n\n");
		const textRanges = JobCompParser.rangesFromText(text);
		job.salary = JobCompParser.formatRanges([...(job.salaryRanges ?? []), ...textRanges]);
		job.location = JobCompParser.mergeLocations([job.location, ...JobCompParser.locationsFromText(text, textRanges)]);
		delete job.salaryRanges;
	}

	// ---------- Site-specific scrapers for pages without JSON-LD ----------

	function fromLinkedIn() {
		const role = first(
			".job-details-jobs-unified-top-card__job-title h1",
			".job-details-jobs-unified-top-card__job-title",
			".jobs-unified-top-card__job-title",
			".top-card-layout__title"
		);
		if (!role) return null;
		const locationText = text(
			first(
				".job-details-jobs-unified-top-card__primary-description-container .tvm__text",
				".job-details-jobs-unified-top-card__bullet",
				".topcard__flavor--bullet"
			)
		);
		const description = first("#job-details", ".jobs-description__content", ".show-more-less-html__markup");
		return {
			company: text(
				first(
					".job-details-jobs-unified-top-card__company-name a",
					".job-details-jobs-unified-top-card__company-name",
					".topcard__org-name-link"
				)
			),
			role: text(role),
			location: locationText.split("·")[0].trim(),
			jobDescription: description ? elementToText(description) : "",
		};
	}

	function fromIndeed() {
		const role = first('[data-testid="jobsearch-JobInfoHeader-title"]', "h1.jobsearch-JobInfoHeader-title");
		if (!role) return null;
		const description = document.querySelector("#jobDescriptionText");
		return {
			company: text(first('[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]')),
			role: text(role).replace(/\s*-\s*job post$/i, ""),
			location: text(first('[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]')),
			jobDescription: description ? elementToText(description) : "",
		};
	}

	// ---------- Greenhouse (job-boards.greenhouse.io, embeds, company sites with ?gh_jid=) ----------
	// Greenhouse job boards have no schema.org markup, so ask its public job API (through the background worker).

	function greenhouseRef() {
		const url = new URL(location.href);
		const eu = /\.eu\.greenhouse\.io$/i.test(url.hostname);
		if (/(^|\.)greenhouse\.io$/i.test(url.hostname)) {
			const board = url.searchParams.get("for");
			const token = url.searchParams.get("token");
			if (board && token) return { board, id: token, eu };
			const m = /^\/([\w-]+)\/jobs\/(\d+)/.exec(url.pathname);
			return m ? { board: m[1], id: m[2], eu } : null;
		}
		const id = url.searchParams.get("gh_jid");
		if (!id) return null;
		// Company career sites embed the board in an iframe (or load it with a script) that names the board.
		for (const el of document.querySelectorAll('iframe[src*="greenhouse.io"], script[src*="greenhouse.io"]')) {
			try {
				const src = new URL(el.src);
				const board = src.searchParams.get("for");
				if (board) return { board, id, eu: /\.eu\.greenhouse\.io$/i.test(src.hostname) };
			} catch {}
		}
		return null;
	}

	function greenhouseUnit(title, max) {
		if (/hour/i.test(title)) return "hour";
		if (/month/i.test(title)) return "month";
		if (/week/i.test(title)) return "week";
		if (/annual|year|salary/i.test(title)) return "year";
		return max < 1500 ? "hour" : "year";
	}

	async function fromGreenhouse() {
		const ref = greenhouseRef();
		if (!ref) return null;
		let data = null;
		try {
			data = await chrome.runtime.sendMessage({ type: "greenhouse-job", ...ref });
		} catch {}
		// Keep the company's own career-site URL when the board is embedded there.
		const pageUrl = location.hostname.endsWith("greenhouse.io") ? "" : canonicalJobUrl();
		if (!data?.title) {
			// API unreachable: fall back to the board page's own markup.
			const role = first(".job__title h1", ".app-title", "h1");
			if (!role) return null;
			const description = first(".job__description", "#content");
			return {
				company: companyFromTitle(document.title, text(role)) || logoCompany(),
				role: text(role),
				location: text(first(".job__location", ".location")).replace(/\s*\|\s*/g, " / "),
				jobDescription: description ? elementToText(description) : "",
				jobUrl: pageUrl,
			};
		}
		const salaryRanges = [].concat(data.pay_input_ranges ?? []).flatMap((r) => {
			const min = Number(r?.min_cents) / 100;
			const max = Number(r?.max_cents) / 100;
			if (!(min > 0) && !(max > 0)) return [];
			const lo = min > 0 ? min : max;
			const hi = max > 0 ? max : min;
			return [{ min: Math.min(lo, hi), max: Math.max(lo, hi), unit: greenhouseUnit(r.title ?? "", hi), currency: r.currency_type || "USD" }];
		});
		return {
			company: data.company_name || companyFromTitle(document.title, data.title) || logoCompany(),
			role: data.title,
			location: String(data.location?.name ?? "").replace(/\s*\|\s*/g, " / "),
			salaryRanges,
			jobDescription: data.content ? htmlToText(data.content) : "",
			jobUrl: pageUrl || data.absolute_url || "",
		};
	}

	// ---------- Generic pages (company career sites like Tesla's) ----------

	const TITLE_SEPARATORS = /\s+(?:\||-|–|—|·|•|::?)\s+/;
	const GENERIC_WORDS = /^(careers?|jobs?|job (?:details|description|posting|search|board)|search( jobs)?|apply( now)?|home|join us|work with us|open (?:positions|roles)|opportunities|life at .+)$/i;
	const ATS_NAMES = /^(greenhouse|lever|ashby|ashbyhq|workday|myworkdayjobs|smartrecruiters|icims|jobvite|bamboohr|linkedin|indeed)$/i;

	function normName(s) {
		return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
	}

	/** "Job Application for X at Acme" / "X at Acme" / "X | Acme Careers" / "Acme - X" → "Acme". */
	function companyFromTitle(title, role) {
		const t = String(title ?? "").replace(/\s+/g, " ").trim();
		const application = /^job application for .+? at (.+)$/i.exec(t);
		if (application) return application[1].trim();
		const roleKey = normName(role);
		const parts = t.split(TITLE_SEPARATORS).map((p) => p.trim()).filter(Boolean);
		if (parts.length > 1) {
			const candidates = parts
				.filter((p) => {
					const k = normName(p);
					return k && (!roleKey || (k !== roleKey && !k.includes(roleKey) && !roleKey.includes(k)));
				})
				.map((p) => p.replace(/\s+(?:careers?|jobs?|job board|recruiting|talent)$/i, "").trim())
				.filter((p) => p && !GENERIC_WORDS.test(p) && !ATS_NAMES.test(p) && p.length <= 60);
			if (candidates.length) return candidates[candidates.length - 1];
		}
		const at = / at ([^|]+)$/i.exec(t);
		return at && !ATS_NAMES.test(at[1].trim()) ? at[1].trim() : "";
	}

	function logoCompany() {
		const alt = document.querySelector('img[alt$=" logo" i]')?.getAttribute("alt") ?? "";
		return alt.replace(/\s*logo$/i, "").trim();
	}

	/** careers.acme.com / jobs.acme.com / acme.com → "Acme". */
	function companyFromHost() {
		const parts = location.hostname.replace(/^www\./, "").split(".");
		const name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
		if (!name || ATS_NAMES.test(name)) return "";
		return name.charAt(0).toUpperCase() + name.slice(1);
	}

	/** Organization name from any schema.org Organization block on the page. */
	function jsonLdOrganization() {
		for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
			try {
				const stack = [JSON.parse(script.textContent)];
				while (stack.length) {
					const node = stack.pop();
					if (!node || typeof node !== "object") continue;
					if (Array.isArray(node)) stack.push(...node);
					else if (node["@type"] === "Organization" && typeof node.name === "string") return node.name.trim();
					else if (node["@graph"]) stack.push(node["@graph"]);
				}
			} catch {}
		}
		return "";
	}

	function fromGenericPage() {
		const ogTitle = meta("og:title");
		// Prefer an h1 in the main content; site headers and nav sometimes carry their own h1 ("Careers").
		const h1s = [...document.querySelectorAll("main h1, article h1, [role=main] h1, h1")].filter((h) => {
			const t = text(h);
			return t && t.length <= 200 && !GENERIC_WORDS.test(t) && h.getClientRects().length > 0;
		});
		let role = text(h1s[0]);
		if (!role) role = (ogTitle || document.title).split(TITLE_SEPARATORS)[0].trim();
		const company =
			meta("og:site_name") ||
			jsonLdOrganization() ||
			companyFromTitle(document.title, role) ||
			companyFromTitle(ogTitle, role) ||
			logoCompany() ||
			companyFromHost();
		return { company, role };
	}

	function canonicalJobUrl() {
		const url = new URL(location.href);
		// LinkedIn search/collection pages carry the open job in a query param; link to the job itself.
		const linkedInJobId = url.hostname.endsWith("linkedin.com") && url.searchParams.get("currentJobId");
		if (linkedInJobId) return `https://www.linkedin.com/jobs/view/${linkedInJobId}/`;
		const indeedJobKey = url.hostname.endsWith("indeed.com") && url.searchParams.get("vjk");
		if (indeedJobKey) return `${url.origin}/viewjob?jk=${indeedJobKey}`;
		url.hash = "";
		return url.toString();
	}

	/** Returns parsed job fields, or null when the page doesn't look like a job posting. */
	async function parseJob({ allowGeneric = false } = {}) {
		const posting = findJobPosting();
		let job = posting ? fromJobPosting(posting) : null;
		const hostname = location.hostname;
		if (!job?.company || !job?.jobDescription) {
			const gh = await fromGreenhouse();
			// Greenhouse fills whatever the page's own JSON-LD left blank.
			if (gh) job = { ...gh, ...Object.fromEntries(Object.entries(job ?? {}).filter(([, v]) => (Array.isArray(v) ? v.length : v))) };
		}
		if (!job && hostname.endsWith("linkedin.com")) job = fromLinkedIn();
		if (!job && hostname.includes("indeed.")) job = fromIndeed();
		if (!job && (allowGeneric || KNOWN_JOB_URL.some((re) => re.test(location.href)))) job = fromGenericPage();
		if (!job || !job.role) return null;
		if (!job.company) job.company = fromGenericPage().company;
		job.jobUrl = job.jobUrl || canonicalJobUrl();
		// Generic pages have no description scraper, so read pay and locations from the main content.
		const mainText = job.jobDescription ? "" : elementToText(document.querySelector("main, article, [role=main]") ?? document.body).slice(0, 40000);
		addPayAndLocations(job, mainText);
		if (job.jobDescription && job.jobDescription.length > JD_MAX) {
			job.jobDescription = job.jobDescription.slice(0, JD_MAX - 1) + "…";
		}
		return job;
	}

	function buildUri(job) {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(job)) {
			if (value) params.set(key, value);
		}
		// Obsidian decodes with decodeURIComponent, which doesn't treat "+" as a space.
		return `obsidian://${URI_ACTION}?${params.toString().replace(/\+/g, "%20")}`;
	}

	// ---------- Top-right prompt (shadow DOM so page CSS can't leak in) ----------

	let host = null;

	function removePrompt() {
		host?.remove();
		host = null;
	}

	/** Keys that identify a job across tabs, reloads and URL variants (tracking params, same job on another site). */
	function jobKeys(job) {
		const keys = [];
		try {
			const url = new URL(job.jobUrl);
			for (const name of [...url.searchParams.keys()]) {
				if (TRACKING_PARAM.test(name)) url.searchParams.delete(name);
			}
			url.hash = "";
			keys.push("url:" + url.toString().replace(/\/$/, ""));
		} catch {}
		const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
		if (job.company && job.role) keys.push(`job:${norm(job.company)}|${norm(job.role)}`);
		return keys;
	}

	async function readList(key) {
		return (await chrome.storage.local.get(key))[key] ?? [];
	}

	async function remember(key, job) {
		try {
			const keys = jobKeys(job);
			const list = await readList(key);
			await chrome.storage.local.set({ [key]: [...list.filter((k) => !keys.includes(k)), ...keys].slice(-LIST_MAX) });
		} catch {}
	}

	async function inList(key, job) {
		const keys = jobKeys(job);
		return (await readList(key)).some((k) => keys.includes(k));
	}

	/** Asks Obsidian whether the job is already in the vault. { reachable: false } when Obsidian isn't running. */
	async function vaultLookup(job) {
		try {
			return (await chrome.runtime.sendMessage({ type: "vault-lookup", job: { url: job.jobUrl, company: job.company, role: job.role } })) ?? { reachable: false };
		} catch {
			return { reachable: false };
		}
	}

	/**
	 * Offers to parse a detected job unless it's already tracked in the vault or the user said "Not now" to it.
	 * When Obsidian isn't running, jobs already sent from this browser are skipped too.
	 */
	async function offerIfNew(job) {
		const detectedOn = location.href;
		let skip;
		try {
			chrome.storage.local.remove(LEGACY_SEEN_KEY).catch(() => {});
			if (await inList(DISMISSED_KEY, job)) return;
			const vault = await vaultLookup(job);
			skip = vault.reachable ? vault.tracked : await inList(SENT_KEY, job);
		} catch {
			return; // Extension reloaded since this page loaded, so its storage can't be reached.
		}
		if (!skip && location.href === detectedOn && !host) showPrompt(job);
	}

	/** Toolbar "Send this job to Obsidian": always shows the card, noting when the job is already tracked. */
	async function offerOnRequest(job) {
		const vault = await vaultLookup(job);
		showPrompt(job, vault.tracked ? vault : null);
	}

	function showPrompt(job, tracked = null) {
		removePrompt();
		host = document.createElement("div");
		host.style.cssText = "all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;";
		const root = host.attachShadow({ mode: "closed" });
		root.innerHTML = `
			<style>
				:host { --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --accent: #7c3aed; --accent-fg: #ffffff; }
				@media (prefers-color-scheme: dark) {
					:host { --bg: #1e1e1e; --fg: #e6e6e6; --muted: #9a9a9a; --border: #3a3a3a; --accent: #8b5cf6; }
				}
				.card { width: 300px; box-sizing: border-box; padding: 14px 16px; background: var(--bg); color: var(--fg);
					border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.18);
					font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
				.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
				.label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
				.close { border: 0; background: none; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
				.role { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.company { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
				.q { margin: 10px 0; }
				.actions { display: flex; gap: 8px; }
				button.btn { flex: 1; padding: 7px 10px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; }
				.primary { background: var(--accent); color: var(--accent-fg); border: 1px solid var(--accent); }
				.secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
			</style>
			<div class="card" role="dialog" aria-label="SWE Job Tracker">
				<div class="head"><span class="label">SWE Job Tracker</span><button class="close" aria-label="Dismiss">×</button></div>
				<div class="role"></div>
				<div class="company"></div>
				<div class="q">Parse this job into Obsidian?</div>
				<div class="actions">
					<button class="btn primary">Parse</button>
					<button class="btn secondary">Skip this job</button>
				</div>
			</div>`;
		root.querySelector(".role").textContent = job.role;
		root.querySelector(".company").textContent = [job.company, job.location].filter(Boolean).join(" · ");
		if (tracked) {
			root.querySelector(".q").textContent = `Already in your vault${tracked.status ? ` (${tracked.status})` : ""}. Parse it again?`;
			root.querySelector(".primary").textContent = "Parse anyway";
		}

		const dismiss = () => {
			remember(DISMISSED_KEY, job);
			removePrompt();
		};
		root.querySelector(".close").addEventListener("click", dismiss);
		root.querySelector(".secondary").addEventListener("click", dismiss);
		root.querySelector(".primary").addEventListener("click", async () => {
			removePrompt();
			// Re-parse at click time: SPA pages may have finished loading the description since detection.
			const fresh = (await parseJob({ allowGeneric: true })) ?? job;
			remember(SENT_KEY, fresh);
			// Launch from a separate extension tab so this job tab is never navigated away or closed.
			chrome.runtime.sendMessage({ type: "open-uri", uri: buildUri(fresh) }).catch(() => {
				// Extension was reloaded since this page loaded; the old content script can't reach it.
				alert("SWE Job Tracker was updated. Reload this page and try again.");
			});
		});
		document.documentElement.appendChild(host);
	}

	// ---------- Detection loop (handles SPA navigation on LinkedIn, Workday, etc.) ----------

	let lastUrl = "";
	let attempts = 0;
	let busy = false;

	async function tick() {
		if (location.href !== lastUrl) {
			lastUrl = location.href;
			attempts = 0;
			removePrompt();
		}
		if (busy || host || attempts >= 10) return;
		attempts++;
		busy = true;
		try {
			const job = await parseJob();
			if (job && location.href === lastUrl) {
				attempts = Infinity;
				await offerIfNew(job);
			}
		} finally {
			busy = false;
		}
	}

	if (window.top === window) {
		setInterval(tick, 1500);
		tick();

		chrome.runtime.onMessage.addListener((msg) => {
			if (msg?.type !== "show-prompt") return;
			parseJob({ allowGeneric: true }).then((job) => job && offerOnRequest(job));
		});
	}
})();
