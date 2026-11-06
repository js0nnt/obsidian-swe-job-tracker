// Fills job application forms from the saved profile, then reports what it couldn't fill and what to double-check.
// Runs in every frame (Greenhouse and others embed the form in an iframe). The results panel lives in the top frame;
// other frames send their reports to it through the background worker.
(() => {
	if (window.__sweAutofillLoaded) return;
	window.__sweAutofillLoaded = true;

	const isTop = window.top === window;
	const LONG_LABEL = 45; // Labels longer than this are questions; plain profile keywords in them are only a guess.
	const QUESTION_LABEL = 90; // Past this, only question-style rules and custom answers apply.

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	const norm = (s) =>
		String(s ?? "")
			.toLowerCase()
			.replace(/[’']/g, "'")
			.replace(/\(\s*(required|optional)\s*\)/g, " ")
			.replace(/[*✱]/g, " ")
			.replace(/[^a-z0-9'+#./,&-]+/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/[\s:?.,-]+$/, "");

	const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const containsWords = (hay, needle) => needle && new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}($|[^a-z0-9])`).test(hay);

	// ---------- Value aliases ----------

	const US_STATES = {
		AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
		DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
		IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
		MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
		NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
		NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
		RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
		VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
		PR: "Puerto Rico",
	};
	const COUNTRY_ALIASES = [
		["united states", "united states of america", "usa", "us", "u.s.", "u.s.a."],
		["united kingdom", "uk", "great britain", "england"],
		["canada", "ca"],
		["india", "in"],
	];

	function aliasesFor(key, value) {
		const v = String(value).trim();
		if (key === "state") {
			const upper = v.toUpperCase();
			if (US_STATES[upper]) return [v, US_STATES[upper]];
			const abbr = Object.keys(US_STATES).find((k) => US_STATES[k].toLowerCase() === v.toLowerCase());
			return abbr ? [v, abbr] : [v];
		}
		if (key === "country") {
			const group = COUNTRY_ALIASES.find((g) => g.includes(v.toLowerCase()));
			return group ? [v, ...group.filter((g) => g !== v.toLowerCase())] : [v];
		}
		if (key === "degree") {
			const base = v.replace(/'s\b/i, "").trim();
			const extra = /bachelor/i.test(v) ? ["bachelor", "b.s.", "bs", "ba", "undergraduate"] : /master/i.test(v) ? ["master", "m.s.", "ms"] : /ph\.?d|doctor/i.test(v) ? ["phd", "doctorate"] : [];
			return [v, base, ...extra];
		}
		return [v];
	}

	// ---------- Profile → answers ----------

	let profile = null;

	async function loadProfile() {
		const stored = (await chrome.storage.local.get(AUTOFILL_KEYS.profile))[AUTOFILL_KEYS.profile];
		profile = { fields: stored?.fields ?? {}, customAnswers: stored?.customAnswers ?? [] };
	}

	const fieldLabel = (key) => PROFILE_FIELD_DEFS[key]?.label ?? key;

	/** Returns { value, phrases, source } or null when the profile has nothing for this key. */
	function answerFor(key) {
		const f = profile.fields;
		const val = (k) => (f[k] ?? "").trim();
		let value = "";
		switch (key) {
			case "fullName": value = [val("firstName"), val("lastName")].filter(Boolean).join(" "); break;
			case "preferredName": value = val("preferredName") || val("firstName"); break;
			case "location": value = [val("city"), val("state")].filter(Boolean).join(", "); break;
			case "gradDate": value = val("gradYear") ? [val("gradMonth"), val("gradYear")].filter(Boolean).join(" ") : ""; break;
			default: value = val(key);
		}
		if (!value) return null;
		const def = PROFILE_FIELD_DEFS[key];
		if (def?.type === "select") {
			const opt = def.options.find((o) => o.value === value);
			if (opt) return { value: opt.value, phrases: [opt.value, opt.label, ...opt.match], source: fieldLabel(key) };
		}
		return { value, phrases: aliasesFor(key, value), source: fieldLabel(key) };
	}

	// Ordered: the first rule that matches the label wins. `q` rules also apply to long question-style labels.
	const RULES = [
		{ key: "needsSponsorship", re: /sponsor/, q: true },
		{ key: "workAuthorized", re: /authori[sz]ed to work|authori[sz]ation to work|eligib\w* to work|legally (able|permitted|allowed) to work|right to work|work authori[sz]ation|work permit/, q: true },
		{ key: "over18", re: /at least 18|over (the age of )?18|18 years|age of 18|age of majority/, q: true },
		{ key: "willingToRelocate", re: /relocat/, q: true },
		{ key: "hispanicLatino", re: /hispanic|latin[oax]/, q: true, exclude: /\brace\b.*\bethnicity\b.*(select|check) all/ },
		{ key: "race", re: /\brace\b|ethnicit/, q: true },
		{ key: "veteran", re: /veteran|military service/, q: true },
		{ key: "disability", re: /disabilit/, q: true },
		{ key: "gender", re: /\bgender\b|\bsex\b/, q: true, exclude: /orientation|transgender/ },
		{ key: "pronouns", re: /pronoun/ },
		{ key: "howHeard", re: /how did you (hear|find|learn|come across)|where did you (hear|find|see|learn)|hear about (us|this)|(lead|referral|application) source|^source$/, q: true },
		{ key: "desiredSalary", re: /salary|compensation|pay (expectation|requirement|range)|desired pay|expected pay/, q: true },
		{ key: "noticePeriod", re: /notice period/, q: true },
		{ key: "startDate", re: /start date|available to start|earliest (possible )?(start|date)|when (can|could|would) you (start|begin|join)|date (of )?availab/, q: true },
		{ key: "yearsExperience", re: /years of ([a-z/+#-]+ )*experience|how many years/, q: true },
		{ key: "coverLetterFile", re: /cover letter/, kinds: ["file"] },
		{ key: "resumeFile", re: /resume|résumé|\bcv\b|curriculum vitae/, kinds: ["file"] },
		{ key: "coverLetterText", re: /cover letter/, q: true, kinds: ["textarea", "text"] },
		{ key: "linkedin", re: /linked ?in/ },
		{ key: "github", re: /git ?hub/ },
		{ key: "portfolio", re: /portfolio|personal (web ?)?site|website|\bblog\b|^url$|other (link|url|website)/ },
		{ key: "email", re: /e-?mail/ },
		{ key: "phone", re: /phone|mobile|\bcell\b|telephone/, exclude: /\btype\b|\bext(ension)?\b|country code|device/ },
		{ key: "preferredName", re: /preferred (first )?name|nick ?name|goes by/ },
		{ key: "firstName", re: /\b(first|given|fore) ?name\b|^first$|\bfname\b/ },
		{ key: "lastName", re: /\b(last|family|sur) ?name\b|^last$|\blname\b/ },
		{ key: "school", re: /school|universit|college|institution|alma mater/ },
		{ key: "degree", re: /\bdegree\b/, exclude: /major|discipline|field|subject/ },
		{ key: "major", re: /\bmajor\b|discipline|field of study|area of study|concentration|course of study/ },
		{ key: "gpa", re: /\bgpa\b|grade point/ },
		{ key: "gradMonth", re: /graduat\w* month/ },
		{ key: "gradYear", re: /graduat\w* year|year of graduation|class of|grad year/ },
		{ key: "gradDate", re: /graduat|grad date/ },
		{ key: "currentTitle", re: /(current|most recent|present) (job )?(title|role|position)|^(job )?title$/ },
		{ key: "currentCompany", re: /(current|most recent|present) (company|employer|organi[sz]ation)|^(company|employer)( name)?$/ },
		{ key: "location", re: /^(current )?location( city)?$|city,? (and )?state|where (are you|do you) (currently )?(located|based|live|reside)|current (city|residence)/, q: true },
		{ key: "street", re: /address (line )?1|street|^address$|mailing address|home address/, exclude: /line 2/ },
		{ key: "city", re: /\bcity\b|\btown\b/ },
		{ key: "zip", re: /\bzip|postal|post code/ },
		{ key: "state", re: /\bstate\b|province|region/, exclude: /united states|statement/ },
		{ key: "country", re: /\bcountry\b/, exclude: /code|countries/ },
		{ key: "fullName", re: /^(your |full |legal |candidate |applicant )*name$/ },
	];

	// Contact details for someone else (references, emergency contacts) must not get the applicant's info.
	const NOT_ME = /emergency|reference|referee|referr(er|ed by|al name)|recruiter|manager|supervisor|spouse|relative/;

	const AUTOCOMPLETE = {
		"given-name": "firstName", "family-name": "lastName", name: "fullName", nickname: "preferredName", email: "email",
		tel: "phone", "tel-national": "phone", "street-address": "street", "address-line1": "street", "address-level2": "city",
		"address-level1": "state", "postal-code": "zip", country: "country", "country-name": "country",
		organization: "currentCompany", "organization-title": "currentTitle", url: "portfolio",
	};

	function matchCustom(label) {
		const hay = norm(label);
		if (!hay) return null;
		for (const entry of profile.customAnswers) {
			if (!entry.answer?.trim()) continue;
			const triggers = entry.question.split(",").map(norm).filter(Boolean);
			const hit = triggers.find((t) => hay.includes(t));
			if (hit) return { value: entry.answer, phrases: [entry.answer.trim()], source: `custom answer "${hit}"` };
		}
		return null;
	}

	/** Decides what this field is asking for. Returns { key, answer, guess } or { key: null }. */
	function classify(field) {
		const custom = matchCustom(field.label);
		if (custom) return { key: "custom", answer: custom, guess: null };

		const kind = field.kind === "textarea" ? "textarea" : field.kind === "file" ? "file" : "text";
		const tryText = (hay, fromLabel) => {
			if (!hay) return null;
			const long = hay.length > LONG_LABEL;
			for (const rule of RULES) {
				if (rule.kinds ? !rule.kinds.includes(kind) : kind === "file") continue;
				if (!rule.re.test(hay) || rule.exclude?.test(hay)) continue;
				if (!rule.q && NOT_ME.test(hay)) continue;
				if (!rule.q && hay.length > QUESTION_LABEL) continue;
				let guess = null;
				if (!fromLabel) guess = "Guessed from the field's hidden name; there's no visible label.";
				else if (long && !rule.q) guess = `Matched on a keyword in a long question; make sure "${fieldLabel(rule.key)}" is the right answer.`;
				return { key: rule.key, guess };
			}
			return null;
		};

		let hit = tryText(norm(field.label), true);
		if (!hit) {
			const ac = (field.el.getAttribute("autocomplete") || "").split(/\s+/).pop();
			if (AUTOCOMPLETE[ac]) hit = { key: AUTOCOMPLETE[ac], guess: field.label ? null : "Guessed from the field's autocomplete hint." };
		}
		if (!hit && !field.label) hit = tryText(norm(field.attrText), false);
		if (!hit) return { key: null };
		if (hit.key === "resumeFile" || hit.key === "coverLetterFile") return { key: hit.key, answer: null, guess: hit.guess };
		return { key: hit.key, answer: answerFor(hit.key), guess: hit.guess };
	}

	// ---------- Finding fields and their labels ----------

	const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

	function textWithoutControls(el) {
		const clone = el.cloneNode(true);
		clone.querySelectorAll("input, select, textarea, option, button, script, style, [role=listbox]").forEach((n) => n.remove());
		return text(clone);
	}

	function isVisible(el) {
		if (!el.isConnected) return false;
		const style = getComputedStyle(el);
		if (style.visibility === "hidden" || style.display === "none") return false;
		return el.getClientRects().length > 0;
	}

	function visibleAnchor(el) {
		let node = el;
		while (node && node !== document.body) {
			if (isVisible(node) && node.offsetWidth > 4 && node.offsetHeight > 4) return node;
			node = node.parentElement;
		}
		return el;
	}

	function byIds(ids) {
		return (ids || "")
			.split(/\s+/)
			.map((id) => id && document.getElementById(id))
			.filter(Boolean)
			.map(textWithoutControls)
			.join(" ")
			.trim();
	}

	// Text that sits just before the field in the DOM (Lever, Workday and many custom forms label fields this way).
	function nearbyText(el) {
		let node = el;
		for (let depth = 0; depth < 5 && node && node !== document.body; depth++) {
			let sib = node.previousElementSibling;
			while (sib) {
				if (!sib.matches("input, select, textarea, button") && !sib.querySelector("input, select, textarea")) {
					const t = textWithoutControls(sib);
					if (t && t.length < 300) return t;
				} else break;
				sib = sib.previousElementSibling;
			}
			node = node.parentElement;
		}
		return "";
	}

	function labelOf(el) {
		if (el.labels?.length) {
			const t = [...el.labels].map(textWithoutControls).filter(Boolean).join(" ");
			if (t) return t;
		}
		const labelledBy = byIds(el.getAttribute("aria-labelledby"));
		if (labelledBy) return labelledBy;
		const aria = el.getAttribute("aria-label");
		if (aria?.trim()) return aria.trim();
		const wrapping = el.closest("label");
		if (wrapping) {
			const t = textWithoutControls(wrapping);
			if (t) return t;
		}
		const near = nearbyText(el);
		if (near) return near;
		return (el.getAttribute("placeholder") || el.getAttribute("title") || "").trim();
	}

	function groupLabelOf(inputs) {
		const first = inputs[0];
		const fieldset = first.closest("fieldset");
		const legend = fieldset?.querySelector("legend");
		if (legend && text(legend)) return textWithoutControls(legend);
		const group = first.closest('[role="radiogroup"], [role="group"]');
		if (group) {
			const t = byIds(group.getAttribute("aria-labelledby")) || group.getAttribute("aria-label");
			if (t) return t.trim();
		}
		// Walk up to the element that holds the whole group, then look for the question text before it.
		let container = first.parentElement;
		while (container && container !== document.body && !inputs.every((i) => container.contains(i))) container = container.parentElement;
		return container ? nearbyText(container) || (fieldset ? textWithoutControls(fieldset).slice(0, 200) : "") : "";
	}

	function humanizeAttr(el) {
		return [el.name, el.id, el.getAttribute("data-automation-id"), el.getAttribute("placeholder")]
			.filter(Boolean)
			.join(" ")
			.replace(/([a-z])([A-Z])/g, "$1 $2")
			.replace(/[_\-[\]]+/g, " ");
	}

	function isRequired(el, label) {
		return el.required || el.getAttribute("aria-required") === "true" || /\*|✱|\(required\)/i.test(label || "");
	}

	const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "search", "password", "range", "color"]);

	function skipElement(el) {
		if (el.disabled || el.readOnly) return true;
		if (el.closest("header, nav, footer, [role=search], [role=navigation], [aria-hidden=true]")) return true;
		if (/captcha|recaptcha|honeypot/i.test(`${el.name} ${el.id} ${el.className}`)) return true;
		return false;
	}

	function collectFields() {
		const fields = [];
		const seen = new Set();
		const add = (field) => {
			field.index = fields.length;
			fields.push(field);
		};

		// Custom dropdowns (react-select on Greenhouse, Workday's listbox buttons).
		for (const el of document.querySelectorAll('input[role="combobox"], button[aria-haspopup="listbox"], div[role="combobox"]:not(:has(input))')) {
			if (seen.has(el) || skipElement(el) || !isVisible(el)) continue;
			seen.add(el);
			const label = labelOf(el);
			add({ kind: "combobox", el, label, attrText: humanizeAttr(el), required: isRequired(el, label) });
		}

		const groups = new Map();
		for (const el of document.querySelectorAll("input, select, textarea")) {
			if (seen.has(el) || skipElement(el)) continue;
			const type = (el.type || "").toLowerCase();
			if (el.tagName === "INPUT" && SKIP_TYPES.has(type)) continue;
			// File inputs are usually hidden behind a styled "Attach" button, so they skip the visibility check.
			if (type !== "file" &&!isVisible(el) && !((type === "radio" || type === "checkbox") && isVisible(el.parentElement))) continue;
			seen.add(el);

			if (type === "radio" || type === "checkbox") {
				const container = el.closest('[role="radiogroup"], [role="group"], fieldset');
				const groupKey = el.name ? `name:${el.name}` : container ? container : null;
				const peers = el.name ? document.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`) : container?.querySelectorAll(`input[type="${type}"]`);
				if (groupKey && peers && (peers.length > 1 || type === "radio")) {
					if (!groups.has(groupKey)) groups.set(groupKey, { type, inputs: [] });
					groups.get(groupKey).inputs.push(el);
					continue;
				}
				const label = labelOf(el);
				add({ kind: "checkbox", el, label, attrText: humanizeAttr(el), required: isRequired(el, label) });
				continue;
			}

			const label = labelOf(el);
			const kind = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : type === "file" ? "file" : "text";
			add({ kind, el, label, attrText: humanizeAttr(el), required: isRequired(el, label) });
		}

		for (const { type, inputs } of groups.values()) {
			const label = groupLabelOf(inputs);
			add({
				kind: type === "radio" ? "radio" : "checkbox-group",
				el: inputs[0],
				inputs,
				label,
				attrText: humanizeAttr(inputs[0]),
				required: inputs.some((i) => isRequired(i, label)),
			});
		}

		// Report fields in page order.
		fields.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
		fields.forEach((f, i) => (f.index = i));
		return fields;
	}

	// ---------- Setting values so React/Vue/Angular notice ----------

	function setNativeValue(el, value) {
		const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
	}

	function blur(el) {
		el.dispatchEvent(new FocusEvent("blur"));
		el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
	}

	function realClick(el) {
		for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
			el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, view: window }));
		}
		el.click();
	}

	function key(el, k, code) {
		el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, keyCode: code, which: code, bubbles: true, cancelable: true }));
	}

	// ---------- Picking an option ----------

	const PLACEHOLDER_OPTION = /^[-–—\s]*(select|choose|please select|please choose|none selected)\b|^[-–—\s]*$/;

	/** Scores options against answer phrases. Returns { option, exact } or null. */
	function bestOption(options, phrases) {
		const qs = phrases.map(norm).filter(Boolean);
		let best = null;
		let runnerUp = -1;
		for (const option of options) {
			const o = norm(option.text);
			if (!o || PLACEHOLDER_OPTION.test(o)) continue;
			let score = 0;
			qs.forEach((q, i) => {
				if (o === q) score = Math.max(score, 300 - i);
				else if (containsWords(o, q)) score = Math.max(score, 200 - i - Math.min(o.length - q.length, 60) / 100);
				else if (o.length >= 3 && containsWords(q, o)) score = Math.max(score, 100 - i);
			});
			if (!score) continue;
			if (!best || score > best.score) {
				runnerUp = best?.score ?? -1;
				best = { option, score };
			} else runnerUp = Math.max(runnerUp, score);
		}
		if (!best) return null;
		const exact = best.score >= 300 - qs.length || (best.score >= 200 - qs.length - 1 && best.score - runnerUp >= 1);
		return { option: best.option, exact };
	}

	const optionText = (o) => o.text.replace(/\s+/g, " ").trim();

	// ---------- Filling each kind of field ----------

	const result = (status, reason, value) => ({ status, reason, value });
	const filled = (value, reason = "") => result("filled", reason, value);
	const check = (value, reason) => result("check", reason, value);
	const unfilled = (reason) => result("unfilled", reason, "");

	function isYes(value) {
		return /^(yes|y|true|i agree|agree)$/i.test(String(value).trim());
	}

	async function fillText(field, answer) {
		const el = field.el;
		const type = (el.type || "").toLowerCase();
		let value = String(answer.value);

		if (type === "date") {
			const d = new Date(value);
			if (Number.isNaN(d.getTime())) return unfilled(`Date field, but your ${answer.source} ("${value}") isn't a date.`);
			value = d.toISOString().slice(0, 10);
		} else if (type === "month") {
			const d = new Date(value);
			if (Number.isNaN(d.getTime())) return unfilled(`Month field, but "${value}" isn't a month and year.`);
			value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
		} else if (type === "number") {
			// Take the first number ("3.8/4.0" -> 3.8, "$120,000" -> 120000) and flag it if anything was dropped.
			const num = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/)?.[0];
			if (!num) return unfilled(`Number-only field, but your answer is "${value}".`);
			if (num !== value.trim()) {
				field.numberNote = `Number-only field, so "${value}" was entered as ${num}.`;
			}
			value = num;
		}

		const notes = field.numberNote ? [field.numberNote] : [];
		if (el.maxLength > 0 && value.length > el.maxLength) {
			notes.push(`Cut off at ${el.maxLength} characters.`);
			value = value.slice(0, el.maxLength);
		}
		el.focus({ preventScroll: true });
		setNativeValue(el, value);
		blur(el);
		field.intended = value;
		return notes.length ? check(value, notes.join(" ")) : filled(value);
	}

	async function fillSelect(field, answer) {
		const el = field.el;
		const options = [...el.options].map((o) => ({ text: optionText(o), el: o }));
		const pick = bestOption(options, answer.phrases);
		if (!pick) return unfilled(`No option matched your ${answer.source} ("${answer.value}"). Pick one yourself.`);
		setNativeValue(el, pick.option.el.value);
		blur(el);
		field.intended = pick.option.el.value;
		return pick.exact ? filled(pick.option.text) : check(pick.option.text, `Picked the closest option to "${answer.value}".`);
	}

	async function fillChoiceGroup(field, answer) {
		const options = field.inputs.map((el) => ({ text: labelOf(el) || el.value, el }));
		if (field.kind === "checkbox-group") {
			// "Check all that apply": tick every option that matches one of the answer's comma-separated parts.
			const parts = String(answer.value).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
			const picked = [];
			let fuzzy = false;
			for (const part of parts.length > 1 ? parts : [null]) {
				const pick = bestOption(options, part ? [part] : answer.phrases);
				if (!pick) continue;
				if (!pick.option.el.checked) realClick(pick.option.el);
				picked.push(pick.option.text);
				fuzzy ||= !pick.exact;
			}
			if (!picked.length) return unfilled(`No option matched your ${answer.source} ("${answer.value}").`);
			return fuzzy ? check(picked.join(", "), `Ticked the closest option to "${answer.value}".`) : filled(picked.join(", "));
		}
		const pick = bestOption(options, answer.phrases);
		if (!pick) return unfilled(`No option matched your ${answer.source} ("${answer.value}"). Pick one yourself.`);
		realClick(pick.option.el);
		field.intendedRadio = pick.option.el;
		return pick.exact ? filled(pick.option.text) : check(pick.option.text, `Picked the closest option to "${answer.value}".`);
	}

	async function fillCheckbox(field, answer) {
		const want = isYes(answer.value);
		if (field.el.checked !== want) realClick(field.el);
		return check(want ? "Ticked" : "Left unticked", `Single checkbox set from your ${answer.source} ("${answer.value}"). Make sure that's what the box means.`);
	}

	function visibleOptions(el) {
		const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
		const scope = (listId && document.getElementById(listId)) || document;
		return [...scope.querySelectorAll('[role="option"]')].filter(isVisible).map((o) => ({ text: textWithoutControls(o) || text(o), el: o }));
	}

	async function waitForOptions(el, timeout) {
		const end = Date.now() + timeout;
		let last = [];
		while (Date.now() < end) {
			const opts = visibleOptions(el);
			// Wait for the list to stop changing (async search results).
			if (opts.length && opts.length === last.length) return opts;
			last = opts;
			await sleep(150);
		}
		return last;
	}

	function closeMenu(el) {
		key(el, "Escape", 27);
		blur(el);
	}

	async function fillCombobox(field, answer) {
		const el = field.el;
		el.scrollIntoView({ block: "center" });
		el.focus({ preventScroll: true });
		realClick(el);
		if (el.tagName === "INPUT") key(el, "ArrowDown", 40);

		let options = await waitForOptions(el, 1200);
		let pick = options.length ? bestOption(options, answer.phrases) : null;

		// Long or async lists (countries, schools, cities) only show matches after typing.
		if (!pick && el.tagName === "INPUT") {
			setNativeValue(el, String(answer.phrases[0] ?? answer.value).slice(0, 60));
			options = await waitForOptions(el, 2500);
			pick = options.length ? bestOption(options, answer.phrases) : null;
			if (!pick && options.length === 1) pick = { option: options[0], exact: false };
		}

		if (!pick) {
			if (el.tagName === "INPUT") setNativeValue(el, "");
			closeMenu(el);
			return unfilled(options.length ? `Dropdown has no option matching your ${answer.source} ("${answer.value}").` : "Custom dropdown didn't open. Pick an option yourself.");
		}

		pick.option.el.scrollIntoView({ block: "nearest" });
		realClick(pick.option.el);
		await sleep(250);
		if (visibleOptions(el).length) closeMenu(el);

		// Confirm the choice shows up near the control.
		let container = el;
		for (let i = 0; i < 4 && container.parentElement; i++) container = container.parentElement;
		const shown = norm(container.textContent).includes(norm(pick.option.text)) || norm(el.value) === norm(pick.option.text);
		if (!shown) return check(pick.option.text, "Picked this option, but couldn't confirm the dropdown kept it.");
		return pick.exact ? filled(pick.option.text) : check(pick.option.text, `Picked the closest option to "${answer.value}".`);
	}

	async function fillFile(field, storageKey, what) {
		const stored = (await chrome.storage.local.get(storageKey))[storageKey];
		if (!stored) return unfilled(`${what} upload. No ${what.toLowerCase()} saved in your autofill profile.`);
		try {
			const blob = await (await fetch(stored.dataUrl)).blob();
			const dt = new DataTransfer();
			dt.items.add(new File([blob], stored.name, { type: stored.type }));
			field.el.files = dt.files;
			field.el.dispatchEvent(new Event("input", { bubbles: true }));
			field.el.dispatchEvent(new Event("change", { bubbles: true }));
		} catch {
			return unfilled(`Couldn't attach your ${what.toLowerCase()} here. Upload it yourself.`);
		}
		await sleep(300);
		if (!field.el.files?.length) return check(stored.name, "Attached the file, but the site cleared it. Check it uploaded, or upload it yourself.");
		return check(stored.name, "File attached. Check the site shows it, since some upload widgets ignore attached files.");
	}

	function alreadyFilled(field) {
		const el = field.el;
		switch (field.kind) {
			case "text":
			case "textarea":
				return el.value.trim() ? el.value.trim() : null;
			case "select":
				return el.selectedIndex > 0 && el.value && !PLACEHOLDER_OPTION.test(norm(el.options[el.selectedIndex]?.text)) ? optionText(el.options[el.selectedIndex]) : null;
			case "radio":
			case "checkbox-group": {
				const on = field.inputs.filter((i) => i.checked);
				return on.length ? on.map((i) => labelOf(i) || i.value).join(", ") : null;
			}
			case "file":
				return el.files?.length ? el.files[0].name : null;
			case "combobox": {
				if (el.tagName !== "INPUT") {
					const shown = textWithoutControls(el);
					return shown && !PLACEHOLDER_OPTION.test(norm(shown)) && !/select one/i.test(shown) ? shown : null;
				}
				// react-select shows the chosen value in a sibling, not in the input.
				const chosen = el.closest('[class*="control"]')?.querySelector('[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"]');
				return chosen ? text(chosen) : el.value.trim() || null;
			}
			default:
				return null;
		}
	}

	async function fillField(field) {
		const prior = alreadyFilled(field);
		if (prior) return filled(prior, "Already filled; left as is.");

		const { key: matchedKey, answer, guess } = classify(field);

		if (field.kind === "file") {
			if (matchedKey === "resumeFile") return fillFile(field, AUTOFILL_KEYS.resume, "Resume");
			if (matchedKey === "coverLetterFile") return fillFile(field, AUTOFILL_KEYS.coverLetter, "Cover letter");
			return unfilled("File upload. Attach it yourself.");
		}

		if (!matchedKey) {
			if (field.kind === "checkbox") {
				return field.required ? unfilled("Required checkbox (often a consent or acknowledgment). Read it and tick it yourself.") : null;
			}
			return unfilled("No saved answer. Answer it yourself, or add a custom answer in your profile for next time.");
		}
		if (!answer) return unfilled(`Your profile's "${fieldLabel(matchedKey)}" is empty.`);

		let res;
		switch (field.kind) {
			case "select": res = await fillSelect(field, answer); break;
			case "radio":
			case "checkbox-group": res = await fillChoiceGroup(field, answer); break;
			case "checkbox": res = await fillCheckbox(field, answer); break;
			case "combobox": res = await fillCombobox(field, answer); break;
			default: res = await fillText(field, answer);
		}
		if (res.status === "filled" && guess) return check(res.value, guess);
		if (res.status === "filled" && field.kind === "textarea" && matchedKey === "custom" && field.label.length > LONG_LABEL) {
			return check(res.value, `Used your ${answer.source}. Make sure it answers this exact question.`);
		}
		return res;
	}

	// After the page has had a moment to react, catch values the site reformatted, rejected or flagged.
	function verify(field, res) {
		if (res.status === "unfilled") return res;
		const el = field.el;
		const invalid = el.getAttribute("aria-invalid") === "true" || (el.willValidate && !el.checkValidity?.());
		if ((field.kind === "text" || field.kind === "textarea") && field.intended !== undefined) {
			const now = el.value;
			if (!now.trim()) return unfilled(`The site cleared the value "${field.intended}". It may want a different format.`);
			// Input masks ("4805551234" -> "(480) 555-1234") only change formatting; anything else is worth a look.
			const bare = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
			if (now !== field.intended && bare(now) !== bare(field.intended)) return check(now, `The site changed "${field.intended}" to "${now}".`);
			if (now !== field.intended) res = filled(now, res.reason);
		}
		if (field.kind === "select" && field.intended !== undefined && el.value !== field.intended) {
			return check(alreadyFilled(field) ?? "", "The site changed the selection after autofill.");
		}
		if (field.kind === "radio" && field.intendedRadio && !field.intendedRadio.checked) {
			return unfilled("Clicked an option, but it didn't stay selected. Pick it yourself.");
		}
		if (invalid) return check(res.value, `The site marks this field as invalid${el.validationMessage ? `: "${el.validationMessage}"` : ""}.`);
		return res;
	}

	// ---------- Run ----------

	let currentRun = null; // { runId, fields: Map<index, field> }
	const OUTLINE = { check: "#d29922", unfilled: "#cf222e", required: "#cf222e" };

	function highlight(field, status) {
		const target = field.inputs ? groupAnchor(field) : visibleAnchor(field.el);
		if (!target.dataset.sweAfPrevOutline) {
			target.dataset.sweAfPrevOutline = JSON.stringify([target.style.outline, target.style.outlineOffset]);
		}
		target.style.outline = `2px ${status === "unfilled" && !field.required ? "dashed" : "solid"} ${OUTLINE[status]}`;
		target.style.outlineOffset = "2px";
		field.anchor = target;
	}

	function groupAnchor(field) {
		let container = field.inputs[0].parentElement;
		while (container && container !== document.body && !field.inputs.every((i) => container.contains(i))) container = container.parentElement;
		return container && container !== document.body ? visibleAnchor(container) : visibleAnchor(field.inputs[0]);
	}

	function clearHighlights() {
		for (const el of document.querySelectorAll("[data-swe-af-prev-outline]")) {
			try {
				const [outline, offset] = JSON.parse(el.dataset.sweAfPrevOutline);
				el.style.outline = outline;
				el.style.outlineOffset = offset;
			} catch {}
			delete el.dataset.sweAfPrevOutline;
		}
	}

	function focusField(index) {
		const field = currentRun?.fields.get(index);
		if (!field) return;
		const target = field.anchor || visibleAnchor(field.el);
		target.scrollIntoView({ behavior: "smooth", block: "center" });
		if (field.kind !== "file") field.el.focus({ preventScroll: true });
		target.animate?.([{ boxShadow: "0 0 0 6px rgba(124,58,237,.55)" }, { boxShadow: "0 0 0 0 rgba(124,58,237,0)" }], { duration: 900, iterations: 2 });
	}

	async function runAutofill(runId) {
		clearHighlights();
		await loadProfile();
		const fields = collectFields();
		const items = [];
		const results = [];
		for (const field of fields) {
			let res;
			try {
				res = await fillField(field);
			} catch (err) {
				res = unfilled(`Autofill hit an error here (${err.message}). Fill it yourself.`);
			}
			if (res) results.push([field, res]);
		}
		await sleep(500);
		const fieldMap = new Map();
		for (const [field, raw] of results) {
			const res = verify(field, raw);
			fieldMap.set(field.index, field);
			if (res.status !== "filled") highlight(field, res.status);
			items.push({
				index: field.index,
				label: cleanLabel(field.label) || cleanLabel(field.attrText) || "(unlabeled field)",
				required: field.required,
				status: res.status,
				reason: res.reason,
				value: String(res.value ?? "").slice(0, 160),
			});
		}
		currentRun = { runId, fields: fieldMap };
		return { runId, items, fieldCount: fields.length };
	}

	const cleanLabel = (s) => String(s || "").replace(/[*✱]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

	// ---------- Messaging ----------

	chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		switch (msg?.type) {
			case "autofill-begin":
				if (isTop) panel.begin(msg.runId);
				sendResponse({ ok: true });
				return;
			case "autofill-run":
				runAutofill(msg.runId).then((report) => {
					if (isTop) panel.addReport(0, report);
					else if (report.fieldCount) chrome.runtime.sendMessage({ type: "autofill-report", report }).catch(() => {});
				});
				return;
			case "autofill-frame-report":
				if (isTop) panel.addReport(msg.frameId, msg.report);
				return;
			case "autofill-focus":
				if (msg.runId === currentRun?.runId) focusField(msg.index);
				return;
			case "autofill-clear":
				clearHighlights();
				return;
		}
	});

	// ---------- Results panel (top frame only, shadow DOM so page CSS can't leak in) ----------

	const panel = (() => {
		let host = null;
		let root = null;
		let runId = null;
		let reports = new Map(); // frameId -> report
		let topDone = false;

		const STYLE = `
			:host { --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d0d7de; --accent: #7c3aed; --accent-fg: #ffffff;
				--warn: #9a6700; --warn-bg: #fff8c5; --bad: #cf222e; --bad-bg: #ffebe9; --ok: #1a7f37; --hover: rgba(127,127,127,.12); }
			@media (prefers-color-scheme: dark) {
				:host { --bg: #1e1e1e; --fg: #e6e6e6; --muted: #9a9a9a; --border: #3a3a3a; --accent: #8b5cf6;
					--warn: #d29922; --warn-bg: rgba(210,153,34,.15); --bad: #f85149; --bad-bg: rgba(248,81,73,.15); --ok: #3fb950; }
			}
			.card { width: 360px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
				box-sizing: border-box; background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 10px;
				box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
			.head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 6px; }
			.label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
			.close { border: 0; background: none; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
			.summary { padding: 0 14px 10px; font-weight: 600; font-size: 14px; }
			.summary .n-check { color: var(--warn); } .summary .n-bad { color: var(--bad); } .summary .n-ok { color: var(--ok); }
			.body { overflow-y: auto; padding: 0 8px 4px; border-top: 1px solid var(--border); }
			h3 { margin: 12px 6px 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
			h3.warn { color: var(--warn); } h3.bad { color: var(--bad); } h3.ok { color: var(--ok); }
			button.item { display: block; width: 100%; text-align: left; border: 0; background: none; color: inherit; font: inherit;
				padding: 7px 8px; border-radius: 6px; cursor: pointer; border-left: 3px solid transparent; }
			button.item:hover, button.item:focus-visible { background: var(--hover); outline: none; }
			button.item.warn { border-left-color: var(--warn); } button.item.bad { border-left-color: var(--bad); }
			.l { font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
			.r { color: var(--muted); font-size: 12px; margin-top: 2px; }
			.v { font-size: 12px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.tag { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
				color: var(--bad); background: var(--bad-bg); border-radius: 4px; padding: 0 5px; margin-left: 6px; vertical-align: 1px; }
			details { margin: 6px 0; } summary { cursor: pointer; padding: 4px 6px; color: var(--muted); font-size: 12px; font-weight: 600; }
			.empty { padding: 14px 6px; color: var(--muted); }
			.foot { display: flex; gap: 8px; padding: 10px 14px 12px; border-top: 1px solid var(--border); align-items: center; }
			.foot .note { flex: 1; color: var(--muted); font-size: 11.5px; }
			button.btn { padding: 6px 10px; border-radius: 6px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
			.primary { background: var(--accent); color: var(--accent-fg); border: 1px solid var(--accent); }
			.secondary { background: transparent; color: var(--fg); border: 1px solid var(--border); }
		`;

		function ensure() {
			if (host) return;
			host = document.createElement("div");
			host.style.cssText = "all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;";
			root = host.attachShadow({ mode: "closed" });
			root.innerHTML = `<style>${STYLE}</style>
				<div class="card" role="dialog" aria-label="Autofill results">
					<div class="head"><span class="label">SWE Job Tracker · Autofill</span><button class="close" aria-label="Close">×</button></div>
					<div class="summary"></div>
					<div class="body"></div>
					<div class="foot">
						<span class="note">Autofill never submits. Review before you apply.</span>
						<button class="btn secondary" data-act="profile">Edit profile</button>
						<button class="btn primary" data-act="rerun">Run again</button>
					</div>
				</div>`;
			root.querySelector(".close").addEventListener("click", close);
			root.querySelector('[data-act="profile"]').addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-options" }).catch(() => {}));
			root.querySelector('[data-act="rerun"]').addEventListener("click", () => chrome.runtime.sendMessage({ type: "autofill-start" }).catch(staleExtension));
			document.documentElement.appendChild(host);
		}

		function staleExtension() {
			root.querySelector(".summary").textContent = "The extension was updated. Reload this page and try again.";
		}

		function close() {
			host?.remove();
			host = null;
			clearHighlights();
			chrome.runtime.sendMessage({ type: "autofill-clear" }).catch(() => {});
		}

		function begin(id) {
			ensure();
			runId = id;
			reports = new Map();
			topDone = false;
			root.querySelector(".summary").textContent = "Filling…";
			root.querySelector(".body").replaceChildren();
		}

		function addReport(frameId, report) {
			if (report.runId !== runId) return;
			ensure();
			reports.set(frameId, report);
			if (frameId === 0) topDone = true;
			render();
		}

		function el(tag, cls, textContent) {
			const n = document.createElement(tag);
			if (cls) n.className = cls;
			if (textContent != null) n.textContent = textContent;
			return n;
		}

		function itemButton(item, tone) {
			const b = el("button", `item ${tone}`);
			const l = el("div", "l", item.label);
			if (item.required && item.status !== "filled") l.append(el("span", "tag", "Required"));
			b.append(l);
			if (item.value && item.status !== "unfilled") b.append(el("div", "v", item.value));
			if (item.reason) b.append(el("div", "r", item.reason));
			b.addEventListener("click", () => {
				if (item.frameId === 0) focusField(item.index);
				else chrome.runtime.sendMessage({ type: "autofill-focus", frameId: item.frameId, index: item.index, runId }).catch(() => {});
			});
			return b;
		}

		function render() {
			const items = [...reports.entries()].flatMap(([frameId, r]) => r.items.map((i) => ({ ...i, frameId })));
			const ok = items.filter((i) => i.status === "filled");
			const warn = items.filter((i) => i.status === "check");
			const bad = items.filter((i) => i.status === "unfilled");
			const badRequired = bad.filter((i) => i.required);
			const badOptional = bad.filter((i) => !i.required);

			const summary = root.querySelector(".summary");
			const body = root.querySelector(".body");
			body.replaceChildren();

			if (!items.length) {
				summary.textContent = topDone ? "No application fields found" : "Filling…";
				if (topDone) {
					body.append(el("div", "empty", "If the form opens in a pop-up or on a later step, open it and click Run again."));
				}
				return;
			}

			summary.replaceChildren(
				el("span", "n-ok", `${ok.length} filled`), " · ",
				el("span", "n-check", `${warn.length} to check`), " · ",
				el("span", "n-bad", `${bad.length} not filled`)
			);

			if (badRequired.length) {
				body.append(el("h3", "bad", "Not filled · required"));
				badRequired.forEach((i) => body.append(itemButton(i, "bad")));
			}
			if (warn.length) {
				body.append(el("h3", "warn", "Check these"));
				warn.forEach((i) => body.append(itemButton(i, "warn")));
			}
			if (badOptional.length) {
				const d = el("details");
				d.open = !badRequired.length && !warn.length;
				d.append(el("summary", null, `Not filled · optional (${badOptional.length})`));
				badOptional.forEach((i) => d.append(itemButton(i, "bad")));
				body.append(d);
			}
			if (ok.length) {
				const d = el("details");
				d.append(el("summary", null, `Filled (${ok.length})`));
				ok.forEach((i) => d.append(itemButton(i, "")));
				body.append(d);
			}
			if (!bad.length && !warn.length) body.prepend(el("div", "empty", "Everything was filled. Still give it a quick read before you submit."));
		}

		return { begin, addReport };
	})();
})();
