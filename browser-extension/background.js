// Clicking the toolbar icon shows the parse prompt even when the page wasn't auto-detected.
chrome.action.onClicked.addListener((tab) => {
	if (tab.id === undefined) return;
	chrome.tabs.sendMessage(tab.id, { type: "show-prompt" }).catch(() => {
		// No content script on this page (chrome://, Web Store, PDF viewer, ...).
	});
});

// Open the obsidian:// link from a short-lived helper tab next to the job tab, leaving the job tab untouched.
chrome.runtime.onMessage.addListener((msg, sender) => {
	if (msg?.type !== "open-uri" || typeof msg.uri !== "string") return;
	if (!msg.uri.startsWith("obsidian://swe-job-tracker-add?")) return;
	const tab = sender.tab;
	chrome.tabs.create({
		url: chrome.runtime.getURL("launch.html") + "#" + encodeURIComponent(msg.uri),
		openerTabId: tab?.id,
		index: tab ? tab.index + 1 : undefined,
	});
});
