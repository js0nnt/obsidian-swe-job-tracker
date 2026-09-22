/**
 * Software-engineering pipeline model.
 *
 * Statuses are free-form strings (users can add their own in settings), so every
 * piece of analytics logic goes through `getStageCategory` / `getStageRank` instead
 * of comparing against hard-coded status names.
 */

export type StageCategory =
	| "applied" // submitted, no response yet
	| "oa" // online assessment / take-home / HackerRank / CodeSignal
	| "screen" // recruiter or phone screen
	| "interview" // Round 1..N, Final Round, Superday, Onsite, Team Match, custom rounds
	| "offer"
	| "accepted"
	| "rejected"
	| "withdrawn"
	| "ghosted";

export const TERMINAL_CATEGORIES: ReadonlySet<StageCategory> = new Set(["accepted", "rejected", "withdrawn", "ghosted"]);

/**
 * Statuses written by the original Job Application Tracker plugin that no longer exist
 * in the SWE pipeline. They are translated on read so old notes keep working, and the
 * "Migrate legacy statuses" command can rewrite them permanently.
 */
export const LEGACY_STATUS_ALIASES: Readonly<Record<string, string>> = {
	Wishlist: "Applied",
	Screening: "OA",
	Interviewing: "Round 1",
};

export function normalizeLegacyStatus(status: string): string {
	return LEGACY_STATUS_ALIASES[status] ?? status;
}

/**
 * Recognizes a status name. Returns null for strings that don't look like a pipeline
 * stage (used by the Sankey diagram to tell sources like "LinkedIn" apart from stages).
 */
export function matchStage(status: string): StageCategory | null {
	const s = (status || "").toLowerCase().trim();
	if (!s) return null;
	if (s === "applied" || s === "submitted") return "applied";
	if (s.includes("accepted")) return "accepted";
	if (s.includes("rejected")) return "rejected";
	if (s.includes("withdrawn")) return "withdrawn";
	if (s.includes("ghosted")) return "ghosted";
	if (s.includes("offer")) return "offer";
	if (/\boa\b/.test(s) || s.includes("assessment") || s.includes("take-home") || s.includes("take home") || s.includes("hackerrank") || s.includes("codesignal")) return "oa";
	if (s.includes("recruiter") || s.includes("phone screen") || s.includes("screening")) return "screen";
	if (/\bround\b/.test(s) || s.includes("final") || s.includes("superday") || s.includes("onsite") || s.includes("on-site") || s.includes("team match") || s.includes("interview") || s.includes("technical")) return "interview";
	return null;
}

/** Category for any status; unknown custom statuses are treated as interview rounds. */
export function getStageCategory(status: string): StageCategory {
	return matchStage(status) ?? "interview";
}

export function isTerminalStatus(status: string): boolean {
	return TERMINAL_CATEGORIES.has(getStageCategory(status));
}

/** Parses "Round 3" → 3. Final rounds sort after any numbered round. */
function roundNumber(status: string): number {
	const s = status.toLowerCase();
	const m = s.match(/round\s*(\d+)/);
	if (m) return Math.min(parseInt(m[1], 10), 8);
	if (s.includes("final") || s.includes("superday") || s.includes("onsite")) return 9;
	return 5;
}

/**
 * Canonical ordering: forward progression gets low values, terminal drop-offs sort
 * to the bottom (>= 100). Used by the Sankey layout and "don't move backwards" checks.
 */
export function getStageRank(status: string): number {
	switch (getStageCategory(status)) {
		case "applied": return 20;
		case "oa": return 30;
		case "screen": return 35;
		case "interview": return 40 + roundNumber(status);
		case "offer": return 60;
		case "accepted": return 70;
		case "ghosted": return 110;
		case "withdrawn": return 120;
		case "rejected": return 130;
	}
}

/** True once the application has gotten any human/company response beyond "Applied". */
export function isResponseStage(status: string): boolean {
	return getStageCategory(status) !== "applied" && getStageCategory(status) !== "ghosted" && getStageCategory(status) !== "withdrawn";
}

/** True for live interview stages (recruiter screen, numbered rounds, final). OA is not an interview. */
export function isInterviewStage(status: string): boolean {
	const c = getStageCategory(status);
	return c === "screen" || c === "interview";
}

/** Stages that count as "reached an interview" for conversion metrics. */
export function reachedInterview(status: string): boolean {
	const c = getStageCategory(status);
	return c === "screen" || c === "interview" || c === "offer" || c === "accepted";
}

export function reachedOffer(status: string): boolean {
	const c = getStageCategory(status);
	return c === "offer" || c === "accepted";
}

/**
 * Picks the status an application should move to when an interview of `roundType` is scheduled.
 * Never moves backwards, never touches offers or closed applications, and only returns
 * statuses that exist in the user's configured pipeline. Returns null for "leave as-is".
 */
export function getAutoAdvanceStatus(currentStatus: string, roundType: string, statuses: readonly string[]): string | null {
	const currentCategory = getStageCategory(currentStatus);
	if (currentCategory === "offer" || TERMINAL_CATEGORIES.has(currentCategory)) return null;

	const currentRank = getStageRank(currentStatus);
	const type = (roundType || "").toLowerCase();

	let target: string | null = null;
	if (type.includes("assessment") || /\boa\b/.test(type) || type.includes("take-home")) {
		target = statuses.find((s) => getStageCategory(s) === "oa") ?? null;
	} else if (type.includes("recruiter")) {
		target = statuses.find((s) => getStageCategory(s) === "screen") ?? null;
	} else if (type.includes("final") || type.includes("superday")) {
		target = statuses.find((s) => getStageCategory(s) === "interview" && roundNumber(s) === 9) ?? null;
	} else {
		// A technical / behavioral / HM round: the next interview stage after the current one.
		target = statuses.find((s) => getStageCategory(s) === "interview" && getStageRank(s) > currentRank) ?? null;
	}

	if (!target || getStageRank(target) <= currentRank) return null;
	return target;
}
