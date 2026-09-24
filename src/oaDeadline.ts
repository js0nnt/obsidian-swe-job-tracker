import { getStageCategory } from "./stages";
import { JobApplication } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(date: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || "");
	if (!m) return null;
	return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

export function formatLocalDate(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-09-24" + 7 → "2026-10-01". Returns "" for an unparseable date. */
export function addDays(date: string, days: number): string {
	const d = parseLocalDate(date);
	if (!d) return "";
	d.setDate(d.getDate() + days);
	return formatLocalDate(d);
}

/** Whole calendar days from today until `date` (negative when overdue), or null if unparseable. */
export function daysUntil(date: string): number | null {
	const d = parseLocalDate(date);
	if (!d) return null;
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((d.getTime() - today.getTime()) / DAY_MS);
}

/**
 * Normalizes a time to "HH:mm". Accepts "14:30", "2:30 PM", "2pm EST", and the minute count
 * YAML 1.1 parsers produce for an unquoted 14:30 (870). Returns "" when it can't be read.
 */
export function normalizeTime(value: unknown): string {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 24 * 60) {
		return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
	}
	if (typeof value !== "string") return "";
	const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(value);
	if (!m || (!m[2] && !m[3])) return "";
	let hours = parseInt(m[1], 10);
	const minutes = m[2] ? parseInt(m[2], 10) : 0;
	const meridiem = m[3]?.toLowerCase().charAt(0);
	if (meridiem) {
		if (hours < 1 || hours > 12) return "";
		if (meridiem === "p" && hours !== 12) hours += 12;
		if (meridiem === "a" && hours === 12) hours = 0;
	}
	if (hours > 23 || minutes > 59) return "";
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "14:30" → "2:30 PM" in the user's locale. */
export function formatTime(time: string): string {
	const t = normalizeTime(time);
	if (!t) return time;
	const [h, m] = t.split(":").map((n) => parseInt(n, 10));
	return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Mon, Sep 28, 2026", or "Mon, Sep 28, 2026 at 2:30 PM" when a time is given. */
export function formatLongDate(date: string, time?: string): string {
	const d = parseLocalDate(date);
	if (!d) return date;
	const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
	return time && normalizeTime(time) ? `${day} at ${formatTime(time)}` : day;
}

/**
 * Short countdown label shown on OA cards. With a due time, the last day counts down in hours
 * and the deadline turns overdue the moment it passes; without one, it's due at the end of the day.
 */
export function describeDeadline(date: string, time?: string): { label: string; urgency: "overdue" | "urgent" | "soon" | "later" } {
	const due = parseLocalDate(date);
	const t = normalizeTime(time);
	if (due && t) {
		const [h, m] = t.split(":").map((n) => parseInt(n, 10));
		due.setHours(h, m);
		const hoursLeft = (due.getTime() - Date.now()) / (60 * 60 * 1000);
		if (hoursLeft < 0 && hoursLeft > -24) return { label: `Overdue ${Math.max(1, Math.round(-hoursLeft))}h`, urgency: "overdue" };
		if (hoursLeft >= 0 && hoursLeft < 1) return { label: `Due in ${Math.max(1, Math.round(hoursLeft * 60))}m`, urgency: "urgent" };
		if (hoursLeft >= 1 && hoursLeft < 24) return { label: `Due in ${Math.round(hoursLeft)}h`, urgency: "urgent" };
	}
	const days = daysUntil(date);
	if (days === null) return { label: date, urgency: "later" };
	if (days < 0) return { label: `Overdue ${-days}d`, urgency: "overdue" };
	if (days === 0) return { label: "Due today", urgency: "urgent" };
	if (days === 1) return { label: "Due tomorrow", urgency: "urgent" };
	return { label: `Due in ${days}d`, urgency: days <= 3 ? "soon" : "later" };
}

/** True when moving `app` to `newStatus` enters an OA stage it wasn't already in. */
export function isEnteringOA(app: JobApplication | undefined, newStatus: string): boolean {
	if (getStageCategory(newStatus) !== "oa") return false;
	return !app || getStageCategory(app.status) !== "oa";
}

/** Closest deadline first (untimed deadlines count as end of day); no deadline sinks to the bottom. */
export function compareByOADeadline(a: JobApplication, b: JobApplication): number {
	if (a.oaDeadline && b.oaDeadline) {
		return a.oaDeadline.localeCompare(b.oaDeadline) || (a.oaDeadlineTime || "24:00").localeCompare(b.oaDeadlineTime || "24:00");
	}
	if (a.oaDeadline) return -1;
	if (b.oaDeadline) return 1;
	return 0;
}
