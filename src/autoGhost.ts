import { JobApplicationFrontMatter } from "./types";
import { matchStage } from "./stages";

function calendarDay(value: unknown): number | null {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const stamp = Date.parse(`${value}T00:00:00Z`);
	if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) return null;
	return stamp / 86400000;
}

/** Only unanswered submissions qualify; unrelated note edits do not restart the clock. */
export function shouldAutoGhost(application: Pick<JobApplicationFrontMatter, "status" | "dateApplied" | "interviews" | "statusHistory">, today: string): boolean {
	if (typeof application.status !== "string" || matchStage(application.status) !== "applied") return false;
	if (Array.isArray(application.interviews) && application.interviews.some(interview => interview?.status !== "Cancelled")) return false;
	let since = calendarDay(application.dateApplied);
	const currentDay = calendarDay(today);
	if (since === null || currentDay === null) return false;
	// The first entry is the note's creation date, which can be later than Date Applied.
	// A subsequent move back to Applied starts a fresh waiting period.
	const history = Array.isArray(application.statusHistory) ? application.statusHistory : [];
	for (const entry of history.slice(1)) {
		if (typeof entry?.status !== "string") return false;
		if (matchStage(entry.status) === "applied") {
			const day = calendarDay(entry.date);
			if (day === null) return false;
			since = Math.max(since, day);
		}
	}
	return currentDay - since >= 21;
}
