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

/** "Mon, Sep 28, 2026" */
export function formatLongDate(date: string): string {
	const d = parseLocalDate(date);
	if (!d) return date;
	return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Short countdown label shown on OA cards. */
export function describeDeadline(date: string): { label: string; urgency: "overdue" | "urgent" | "soon" | "later" } {
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

/** Closest deadline first; applications without a deadline sink to the bottom. */
export function compareByOADeadline(a: JobApplication, b: JobApplication): number {
	if (a.oaDeadline && b.oaDeadline) return a.oaDeadline.localeCompare(b.oaDeadline);
	if (a.oaDeadline) return -1;
	if (b.oaDeadline) return 1;
	return 0;
}
