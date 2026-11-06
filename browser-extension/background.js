const PROFILE_KEY = "autofillProfile";

function openOptions(setup = false) {
	chrome.tabs.create({ url: chrome.runtime.getURL("options.html" + (setup ? "?setup=1" : "")) });
}

async function hasProfile() {
	const profile = (await chrome.storage.local.get(PROFILE_KEY))[PROFILE_KEY];
	const f = profile?.fields ?? {};
	return Boolean(f.firstName || f.lastName || f.email);
}

/** Opens the results panel in the top frame, then asks every frame (including iframes) to fill its fields. */
async function startAutofill(tabId) {
	if (!(await hasProfile())) {
		openOptions(true);
		return { ok: false, error: "setup" };
	}
	const runId = String(Date.now());
	try {
		await chrome.tabs.sendMessage(tabId, { type: "autofill-begin", runId }, { frameId: 0 });
	} catch {
		return { ok: false, error: "Can't run on this page. If it was open before the extension loaded, reload it and try again." };
	}
	chrome.tabs.sendMessage(tabId, { type: "autofill-run", runId }).catch(() => {});
	return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	const tabId = msg?.tabId ?? sender.tab?.id;
	switch (msg?.type) {
		case "open-uri": {
			// Open the obsidian:// link from a short-lived helper tab next to the job tab, leaving the job tab untouched.
			if (typeof msg.uri !== "string" || !msg.uri.startsWith("obsidian://swe-job-tracker-add?")) return;
			const tab = sender.tab;
			chrome.tabs.create({
				url: chrome.runtime.getURL("launch.html") + "#" + encodeURIComponent(msg.uri),
				openerTabId: tab?.id,
				index: tab ? tab.index + 1 : undefined,
			});
			return;
		}
		case "autofill-start":
			if (tabId === undefined) return;
			startAutofill(tabId).then(sendResponse);
			return true;
		case "autofill-report":
			// An iframe finished; hand its results to the panel in the top frame.
			if (tabId !== undefined) {
				chrome.tabs.sendMessage(tabId, { type: "autofill-frame-report", frameId: sender.frameId, report: msg.report }, { frameId: 0 }).catch(() => {});
			}
			return;
		case "autofill-focus":
			if (tabId !== undefined) {
				chrome.tabs.sendMessage(tabId, { type: "autofill-focus", index: msg.index, runId: msg.runId }, { frameId: msg.frameId }).catch(() => {});
			}
			return;
		case "autofill-clear":
			if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: "autofill-clear" }).catch(() => {});
			return;
		case "open-options":
			openOptions();
			return;
	}
});

chrome.commands.onCommand.addListener(async (command) => {
	if (command !== "autofill") return;
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id !== undefined) startAutofill(tab.id);
});
