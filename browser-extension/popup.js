const errorEl = document.getElementById("error");

function showError(message) {
	errorEl.textContent = message;
	errorEl.hidden = false;
}

async function activeTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab;
}

document.getElementById("autofill").addEventListener("click", async () => {
	const tab = await activeTab();
	if (tab?.id === undefined) return;
	const res = await chrome.runtime.sendMessage({ type: "autofill-start", tabId: tab.id });
	if (res?.ok || res?.error === "setup") window.close();
	else showError(res?.error ?? "Autofill couldn't start on this page.");
});

document.getElementById("parse").addEventListener("click", async () => {
	const tab = await activeTab();
	if (tab?.id === undefined) return;
	try {
		await chrome.tabs.sendMessage(tab.id, { type: "show-prompt" }, { frameId: 0 });
		window.close();
	} catch {
		showError("Can't read this page. If it was open before the extension loaded, reload it and try again.");
	}
});

document.getElementById("profile").addEventListener("click", () => {
	chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
	window.close();
});

(async () => {
	const profile = (await chrome.storage.local.get("autofillProfile")).autofillProfile;
	const f = profile?.fields ?? {};
	const name = [f.firstName, f.lastName].filter(Boolean).join(" ");
	document.getElementById("who").textContent = name ? `Autofilling as ${name}` : "No autofill profile yet. Autofill opens the setup page.";
	const commands = await chrome.commands.getAll();
	const shortcut = commands.find((c) => c.name === "autofill")?.shortcut;
	if (shortcut) document.getElementById("shortcut").textContent = `Shortcut: ${shortcut}`;
})();
