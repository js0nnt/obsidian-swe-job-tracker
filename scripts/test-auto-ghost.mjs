import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";

class TFile { path = "Applications/Test.md"; basename = "Test"; }
async function load(path) {
	const result = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian"] });
	const module = { exports: {} };
	runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, console, require: () => ({
		TFile, Notice: class {}, normalizePath: path => path,
	}) });
	return module.exports;
}
const { shouldAutoGhost } = await load("src/autoGhost.ts");
const base = { status: "Applied", dateApplied: "2026-09-01", interviews: [], statusHistory: [{ status: "Applied", date: "2026-09-20" }] };
assert.equal(shouldAutoGhost(base, "2026-09-21"), false);
assert.equal(shouldAutoGhost(base, "2026-09-22"), true);
assert.equal(shouldAutoGhost({ ...base, lastUpdated: "2026-09-22" }, "2026-09-22"), true);
for (const status of ["OA", "Recruiter Screen", "Round 1", "Offer", "Accepted", "Rejected", "Withdrawn", "Ghosted", "Custom stage"]) {
	assert.equal(shouldAutoGhost({ ...base, status }, "2026-09-29"), false, status);
}
assert.equal(shouldAutoGhost({ ...base, status: "Submitted" }, "2026-09-22"), true);
for (const dateApplied of ["", "bad", "2026-02-30", "2026-10-01"]) {
	assert.equal(shouldAutoGhost({ ...base, dateApplied }, "2026-09-29"), false);
}
for (const status of ["Scheduled", "Completed"]) {
	assert.equal(shouldAutoGhost({ ...base, interviews: [{ status }] }, "2026-09-29"), false);
}
assert.equal(shouldAutoGhost({ ...base, dateApplied: "2026-03-01" }, "2026-03-22"), true);
assert.equal(shouldAutoGhost({ ...base, statusHistory: [...base.statusHistory, { status: "Applied", date: "2026-09-20" }] }, "2026-09-29"), false);

const { ApplicationService } = await load("src/services/ApplicationService.ts");
const file = new TFile();
let fm = structuredClone(base);
let body = "## Notes & Activity Log\n";
let bodyWrites = 0;
const plugin = { settings: { autoGhostEnabled: true, statuses: ["Applied", "Ghosted"] } };
const app = {
	vault: {
		getAbstractFileByPath: () => file,
		process: async (_file, transform) => { body = transform(body); bodyWrites++; },
	},
	fileManager: { processFrontMatter: async (_file, transform) => transform(fm) },
};
const service = new ApplicationService(app, plugin);
service.getTodayDateString = () => "2026-09-22";
const candidate = { ...structuredClone(base), filePath: file.path };
await service.autoGhostApplication(candidate);
assert.equal(fm.status, "Ghosted");
assert.equal(fm.statusHistory.at(-1).status, "Ghosted");
assert.match(body, /Automatically marked Ghosted/);
assert.equal(bodyWrites, 1);
await service.autoGhostApplication(candidate);
assert.equal(bodyWrites, 1, "Stale scans must not create duplicate history or notes");
await service.updateStatus(file, "Applied");
assert.equal(fm.statusHistory.at(-1).date, "2026-09-22");
await service.autoGhostApplication(candidate);
assert.equal(fm.status, "Applied", "Manual reopening starts a fresh waiting period");
fm = { ...structuredClone(base), status: "Offer" };
await service.autoGhostApplication(candidate);
assert.equal(fm.status, "Offer", "Live changes must win over the scan");
plugin.settings.autoGhostEnabled = false;
fm = structuredClone(base);
await service.autoGhostApplication(candidate);
assert.equal(fm.status, "Applied");
console.log("Passed 21-day boundary, invalid dates, interview exclusions, reopening, live rechecks, history, idempotence, and disabled automation.");
