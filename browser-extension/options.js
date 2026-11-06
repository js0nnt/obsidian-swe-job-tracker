const form = document.getElementById("profile");
const qaList = document.getElementById("qa-list");
const statusEl = document.getElementById("status");

let profile = { fields: {}, customAnswers: [] };
let saveTimer = null;
let statusTimer = null;

function showStatus(message, isError = false) {
	statusEl.textContent = message;
	statusEl.classList.toggle("error", isError);
	statusEl.classList.add("show");
	clearTimeout(statusTimer);
	statusTimer = setTimeout(() => statusEl.classList.remove("show"), isError ? 4000 : 1200);
}

function scheduleSave() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(async () => {
		profile.customAnswers = readCustomAnswers();
		try {
			await chrome.storage.local.set({ [AUTOFILL_KEYS.profile]: profile });
			showStatus("Saved");
		} catch (err) {
			showStatus(`Couldn't save: ${err.message}`, true);
		}
	}, 300);
}

// ---------- Profile fields ----------

function renderProfile() {
	for (const section of PROFILE_SECTIONS) {
		const el = document.createElement("section");
		const h2 = document.createElement("h2");
		h2.textContent = section.title;
		el.append(h2);
		if (section.note) {
			const note = document.createElement("p");
			note.className = "note";
			note.textContent = section.note;
			el.append(note);
		}
		const grid = document.createElement("div");
		grid.className = "grid";
		for (const def of section.fields) grid.append(renderField(def));
		el.append(grid);
		form.append(el);
	}
}

function renderField(def) {
	const label = document.createElement("label");
	label.className = "field" + (def.type === "textarea" ? " full" : "");
	const title = document.createElement("span");
	title.textContent = def.label;
	if (def.hint) {
		const hint = document.createElement("span");
		hint.className = "hint";
		hint.textContent = ` (${def.hint})`;
		title.append(hint);
	}
	label.append(title);

	let input;
	if (def.type === "select") {
		input = document.createElement("select");
		input.append(new Option("Leave blank", ""));
		for (const opt of def.options) input.append(new Option(opt.label, opt.value));
	} else if (def.type === "textarea") {
		input = document.createElement("textarea");
	} else {
		input = document.createElement("input");
		input.type = def.type || "text";
	}
	if (def.placeholder) input.placeholder = def.placeholder;
	input.name = def.key;
	input.value = profile.fields[def.key] ?? "";
	input.addEventListener("input", () => {
		profile.fields[def.key] = input.value.trim() ? input.value : "";
		scheduleSave();
	});
	label.append(input);
	return label;
}

// ---------- Custom answers ----------

function addQaRow(entry = { question: "", answer: "" }) {
	const row = document.createElement("div");
	row.className = "qa";
	const q = document.createElement("input");
	q.placeholder = "Question contains… e.g. clearance, security clearance";
	q.value = entry.question;
	q.dataset.role = "question";
	const a = document.createElement("textarea");
	a.placeholder = "Your answer";
	a.value = entry.answer;
	a.dataset.role = "answer";
	const remove = document.createElement("button");
	remove.type = "button";
	remove.className = "danger";
	remove.textContent = "Remove";
	remove.addEventListener("click", () => {
		row.remove();
		scheduleSave();
	});
	q.addEventListener("input", scheduleSave);
	a.addEventListener("input", scheduleSave);
	row.append(q, a, remove);
	qaList.append(row);
	return row;
}

function readCustomAnswers() {
	return [...qaList.querySelectorAll(".qa")]
		.map((row) => ({
			question: row.querySelector('[data-role="question"]').value.trim(),
			answer: row.querySelector('[data-role="answer"]').value,
		}))
		.filter((e) => e.question || e.answer.trim());
}

document.getElementById("qa-add").addEventListener("click", () => {
	addQaRow().querySelector("input").focus();
});

// ---------- Files ----------

function readAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

async function setupFileRow(row) {
	const storageKey = AUTOFILL_KEYS[row.dataset.file];
	const nameEl = row.querySelector(".name");
	const input = row.querySelector("input[type=file]");
	const removeBtn = row.querySelector(".remove");

	const show = (stored) => {
		nameEl.textContent = stored ? `${stored.name} (${Math.ceil(stored.size / 1024)} KB)` : "No file";
		removeBtn.hidden = !stored;
	};
	show((await chrome.storage.local.get(storageKey))[storageKey]);

	row.querySelector(".pick").addEventListener("click", () => input.click());
	input.addEventListener("change", async () => {
		const file = input.files[0];
		input.value = "";
		if (!file) return;
		if (file.size > AUTOFILL_MAX_FILE_BYTES) {
			showStatus("That file is over 4 MB.", true);
			return;
		}
		const stored = { name: file.name, type: file.type || "application/octet-stream", size: file.size, dataUrl: await readAsDataUrl(file) };
		try {
			await chrome.storage.local.set({ [storageKey]: stored });
			show(stored);
			showStatus("Saved");
		} catch (err) {
			showStatus(`Couldn't save the file: ${err.message}`, true);
		}
	});
	removeBtn.addEventListener("click", async () => {
		await chrome.storage.local.remove(storageKey);
		show(null);
		showStatus("Removed");
	});
}

// ---------- Init ----------

(async () => {
	const stored = (await chrome.storage.local.get(AUTOFILL_KEYS.profile))[AUTOFILL_KEYS.profile];
	if (stored) profile = { fields: stored.fields ?? {}, customAnswers: stored.customAnswers ?? [] };
	renderProfile();
	for (const entry of profile.customAnswers) addQaRow(entry);
	if (!profile.customAnswers.length) addQaRow();
	document.querySelectorAll(".file-row").forEach(setupFileRow);
	if (new URLSearchParams(location.search).has("setup")) document.getElementById("setup-banner").hidden = false;
})();
