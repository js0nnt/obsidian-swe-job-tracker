// Pulls pay ranges and locations out of free-form job posting text.
// Postings word pay in many ways (hourly, monthly, yearly, "$120K/yr", one range per location...), so this collects every
// range it trusts, groups them by currency and pay period, and reports the lowest to highest figure in each group.
(() => {
	const UNITS = ["hour", "week", "month", "year"];
	// Plausible amounts per pay period; anything outside is probably not pay (funding, headcount, stipends).
	const UNIT_BOUNDS = { hour: [7, 1500], week: [200, 40000], month: [500, 150000], year: [10000, 3000000] };

	const CURRENCY_CODES = { USD: "USD", CAD: "CAD", AUD: "AUD", GBP: "GBP", EUR: "EUR", INR: "INR" };
	const SYMBOLS = { "US$": "USD", "CA$": "CAD", C$: "CAD", "AU$": "AUD", A$: "AUD", $: "USD", "£": "GBP", "€": "EUR", "₹": "INR" };

	// Amount token: optional currency prefix, number, optional k, optional currency code suffix.
	const TOKEN = /(US\$|CA\$|C\$|AU\$|A\$|USD|CAD|AUD|GBP|EUR|INR|\$|£|€|₹)?[  ]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?[  ]?([kK](?![a-zA-Z]))?(?:[  ]?(USD|CAD|AUD|GBP|EUR|INR)\b)?(?![\d,]*\d)/g;

	const RANGE_JOINER = /^\s*(?:\/\s*(?:hr|hour|yr|year|mo|month|wk|week)\.?\s*)?(?:-|–|—|to|and|through)\s*$/i;
	const NOT_PAY_AFTER = /^\s*(?:\+\s*)?(?:million|billion|mm\b|bn\b|m\b|b\b|employees|people|customers|users|members|countries|in (?:funding|revenue|arr)|of (?:funding|revenue))/i;

	const COMP_WORDS = /salary|salaries|compensation|\bpay\b|pay range|pay rate|base|wage|hourly|\brate\b|\bote\b|earn|range|annual|stipend for (?:interns?|this)|per (?:hour|year|month)|remuneration|\bctc\b|\btc\b/gi;
	const PERK_WORDS = /stipend|bonus|budget|reimburs|allowance|credit|401|match|equity|stock|rsu|sign[- ]on|signing|relocation|referral|raised|funding|valuation|revenue|series [a-e]\b|wellness|learning|gym|home office|insurance|premium|deductible|donation|\bfee\b|cost/gi;

	const UNIT_PATTERNS = [
		["hour", /(?:per|an|a|\/)\s?(?:hour|hr)\b|\bhourly\b|\/\s?h\b|\bph\b/i],
		["week", /(?:per|a|\/)\s?(?:week|wk)\b|\bweekly\b/i],
		["month", /(?:per|a|\/)\s?(?:month|mo)\b|\bmonthly\b|\bpm\b/i],
		["year", /(?:per|a|\/)\s?(?:year|yr|annum)\b|\bannual(?:ly|ized)?\b|\byearly\b|\bp\.?a\.?(?![a-z])/i],
	];
	const UNIT_WORDS_BEFORE = [
		["hour", /hourly|per hour|an hour|\/hr/gi],
		["week", /weekly|per week/gi],
		["month", /monthly|per month/gi],
		["year", /annual|yearly|per year|salary|salaries|per annum/gi],
	];

	function unitAfter(s) {
		for (const [unit, re] of UNIT_PATTERNS) if (re.test(s)) return unit;
		return null;
	}

	/** The pay period mentioned last in the text before the amount ("Hourly pay range: ..."). */
	function unitBefore(s) {
		let best = null;
		let bestIdx = -1;
		for (const [unit, re] of UNIT_WORDS_BEFORE) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(s))) if (m.index > bestIdx) [best, bestIdx] = [unit, m.index];
		}
		return best;
	}

	function lastIndex(re, s) {
		re.lastIndex = 0;
		let idx = -1;
		let m;
		while ((m = re.exec(s))) idx = m.index;
		return idx;
	}

	function inferUnit(value) {
		if (value <= 500) return "hour";
		if (value >= 1000 && value < 20000) return "month";
		if (value >= 20000) return "year";
		return null;
	}

	function tokenize(textIn) {
		const tokens = [];
		TOKEN.lastIndex = 0;
		let m;
		while ((m = TOKEN.exec(textIn))) {
			const [raw, prefix, whole, frac, k, suffix] = m;
			if (!whole) continue;
			const start = m.index + (raw.length - raw.trimStart().length);
			// A digit or letter glued to the front means it's part of something else ("Q4", "x100", "2024").
			const before = textIn[start - 1];
			if (!prefix && before && /[A-Za-z0-9.]/.test(before)) continue;
			let value = Number(whole.replace(/,/g, "") + (frac ?? ""));
			if (k) value *= 1000;
			const currency = prefix ? SYMBOLS[prefix] ?? CURRENCY_CODES[prefix] : suffix ? CURRENCY_CODES[suffix] : null;
			// "CA$" / "USD $" style prefixes: let a following code override a bare "$".
			const currencyFinal = suffix && prefix === "$" ? CURRENCY_CODES[suffix] : currency;
			tokens.push({ value, currency: currencyFinal, hasCurrency: Boolean(prefix || suffix), start, end: m.index + raw.length });
		}
		return tokens;
	}

	/** Every pay range the text states, as { min, max, unit, currency, start, end }. */
	function rangesFromText(textIn) {
		if (!textIn) return [];
		const s = String(textIn);
		const tokens = tokenize(s);
		const ranges = [];
		for (let i = 0; i < tokens.length; i++) {
			const a = tokens[i];
			let b = null;
			const next = tokens[i + 1];
			if (next && RANGE_JOINER.test(s.slice(a.end, next.start)) && (a.hasCurrency || next.hasCurrency)) {
				b = next;
				i++;
			}
			if (!a.hasCurrency && !b?.hasCurrency) continue;
			const end = (b ?? a).end;
			const after = s.slice(end, Math.min(end + 40, tokens[i + 1]?.start ?? Infinity));
			if (NOT_PAY_AFTER.test(after)) continue;
			// "$100 billion" style suffixes on the first amount of a range too.
			if (b && NOT_PAY_AFTER.test(s.slice(a.end, a.end + 12))) continue;

			const lineStart = Math.max(s.lastIndexOf("\n", a.start - 1) + 1, a.start - 160);
			const before = s.slice(lineStart, a.start);
			const before2 = s.slice(Math.max(0, a.start - 400), a.start);
			// Perks and funding that happen to be in dollars: skip unless pay wording is closer to the amount.
			const comp = lastIndex(COMP_WORDS, before);
			const perk = lastIndex(PERK_WORDS, before);
			if (perk > comp) continue;
			if (/^\s*(?:\/\s*\w+\s*)?(?:per\s+\w+\s+)?(?:stipend|bonus|budget|allowance|credit|sign[- ]on|signing|relocation|reimbursement)/i.test(after)) continue;

			let unit = unitAfter(s.slice(a.end, end)) || unitAfter(after) || unitBefore(before2);
			const lo = Math.min(a.value, b?.value ?? a.value);
			const hi = Math.max(a.value, b?.value ?? a.value);
			if (!unit) unit = inferUnit(hi);
			if (!unit) continue;
			// "$120 - $150" with a yearly label usually means thousands.
			if (unit === "year" && hi < 1000 && lo >= 20) {
				ranges.push({ min: lo * 1000, max: hi * 1000, unit, currency: a.currency || b?.currency || "USD", start: a.start, end });
				continue;
			}
			const [minOk, maxOk] = UNIT_BOUNDS[unit];
			if (lo < minOk || hi > maxOk) continue;
			// A single amount needs pay wording or an explicit period nearby; ranges are trusted more.
			if (!b && comp < 0 && !unitAfter(after)) continue;
			ranges.push({ min: lo, max: hi, unit, currency: a.currency || b?.currency || "USD", start: a.start, end });
		}
		return ranges;
	}

	const JSONLD_UNITS = { HOUR: "hour", DAY: null, WEEK: "week", MONTH: "month", YEAR: "year" };

	/** Pay ranges from schema.org baseSalary / estimatedSalary (object or array). */
	function rangesFromJsonLd(posting) {
		const out = [];
		for (const base of [].concat(posting?.baseSalary ?? [], posting?.estimatedSalary ?? [])) {
			if (!base || typeof base !== "object") continue;
			for (const value of [].concat(typeof base.value === "object" && base.value ? base.value : { value: base.value })) {
				const nums = [value.minValue, value.maxValue, value.value].map(Number).filter((n) => Number.isFinite(n) && n > 0);
				if (!nums.length) continue;
				const rawUnit = String(value.unitText || base.unitText || "").toUpperCase();
				const unit = JSONLD_UNITS[rawUnit] ?? inferUnit(Math.max(...nums));
				if (!unit) continue;
				out.push({ min: Math.min(...nums), max: Math.max(...nums), unit, currency: base.currency || value.currency || "USD" });
			}
		}
		return out;
	}

	function money(n, currency) {
		const decimals = n % 1 ? 2 : 0;
		try {
			return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
		} catch {
			return `${n.toLocaleString("en-US")} ${currency}`;
		}
	}

	/** "$45 - $60 / hour · $120,000 - $185,000 / year": lowest to highest per currency and pay period. */
	function formatRanges(ranges) {
		const groups = new Map();
		for (const r of ranges) {
			const key = `${r.currency}|${r.unit}`;
			const g = groups.get(key);
			if (g) {
				g.min = Math.min(g.min, r.min);
				g.max = Math.max(g.max, r.max);
			} else groups.set(key, { ...r });
		}
		return [...groups.values()]
			.sort((x, y) => UNITS.indexOf(x.unit) - UNITS.indexOf(y.unit))
			.map((g) => `${g.min === g.max ? money(g.min, g.currency) : `${money(g.min, g.currency)} - ${money(g.max, g.currency)}`} / ${g.unit}`)
			.join(" · ");
	}

	// ---------- Locations ----------

	const NOT_A_PLACE = /salary|pay|range|compensation|base|hourly|annual|rate|wage|\bote\b|target|bonus|equity|level|zone|tier|band|grade|role|position|candidate|experience|this|our|we\b|you|the following|all |benefit|total|starting|minimum|maximum|\bmin\b|\bmax\b|\bl\d\b|ic\d|senior|junior|staff|principal|intern|new grad/i;

	function cleanPlace(raw) {
		let s = String(raw ?? "").replace(/\s+/g, " ").trim();
		const paren = s.match(/\(([^)]{2,120})\)/);
		if (paren && /zone|tier|band|area|geo|market|region|location/i.test(s.replace(paren[0], ""))) s = paren[1];
		s = s.replace(/^(?:the|in|for|located in|based in|candidates (?:in|based in)|roles? in|employees in)\s+/i, "")
			.replace(/\s*(?:area|metro(?:politan)? area|metro)$/i, (m) => (/bay area/i.test(s) ? m : ""))
			.replace(/[\s:,.\-–—]+$/, "")
			.replace(/^[\s:,.\-–—•*]+/, "")
			.trim();
		if (s.length < 2 || s.length > 80) return "";
		if (!/^[A-Z]/.test(s) || /\d{3,}/.test(s) || NOT_A_PLACE.test(s)) return "";
		return s;
	}

	/** Splits "San Francisco, CA; New York, NY | Remote (US)" into individual places. */
	function splitPlaces(list) {
		return list
			.split(/\s*(?:;|\||•|·|\n|\s\/\s|\s+or\s+|\s+and\s+)\s*/)
			.flatMap((part) => part.split(/(?<=,\s?[A-Z]{2}\b),\s*(?=[A-Z])/))
			.map(cleanPlace)
			.filter(Boolean);
	}

	/** Locations named in the text: "Locations: ..." lines and the labels of per-location pay ranges. */
	function locationsFromText(textIn, ranges = rangesFromText(textIn)) {
		const s = String(textIn ?? "");
		const out = [];
		for (const m of s.matchAll(/^[\s•*-]*(?:job |office |work |hiring )?locations?(?: available)?\s*[:\-–]\s*(.+)$/gim)) out.push(...splitPlaces(m[1]));

		for (const r of ranges) {
			if (r.start === undefined) continue;
			const lineStart = s.lastIndexOf("\n", r.start - 1) + 1;
			const prefix = s.slice(lineStart, r.start);
			// "San Francisco Bay Area: $150,000 - $200,000" or "Zone 1 (NYC, SF) - $..."
			const labeled = prefix.match(/^[\s•*-]*([^:\n$]{2,120}?)\s*[:\-–—]\s*(?:(?:US)?\$|USD|CAD)?\s*$/);
			if (labeled) {
				const zone = labeled[1].match(/^(?:zone|tier|band|geo|region|market|area)\b[^(]*\(([^)]+)\)/i);
				// Zone lists are plain comma-separated cities unless they carry state codes ("Austin, TX").
				if (zone && !/,\s?[A-Z]{2}\b/.test(zone[1])) out.push(...zone[1].split(/\s*,\s*|\s+and\s+/).map(cleanPlace).filter(Boolean));
				else out.push(...splitPlaces(labeled[1]));
			}
			// "The pay range for this role in New York City is $..." (only the sentence the amount is in).
			const clause = prefix.slice(Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("; ")) + 1);
			const sentence = [...clause.matchAll(/\b(?:[Ii]n|[Ff]or (?:candidates |roles |employees )?(?:in|based in)|located in)\s+((?:the\s+)?[A-Z][\w.'-]*(?:(?:,\s*|\s+)(?:[A-Z][\w.'-]*|[A-Z]{2}\b))*)(?:\s+(?:is|are|will be|ranges?|area)\b|\s+the\s+(?:\w+\s+){0,2}range|\s*[:,])/g)].pop();
			if (sentence) out.push(...splitPlaces(sentence[1]));
		}
		return out;
	}

	const placeKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

	/** Dedupes places, dropping ones another entry already covers ("New York" when "New York, NY" is listed). */
	function mergeLocations(places) {
		const list = [];
		for (const raw of places.flatMap((p) => String(p ?? "").split(/\s+\/\s+/))) {
			const p = raw.trim();
			if (!p) continue;
			const k = placeKey(p);
			if (!k) continue;
			const coveredBy = list.findIndex((q) => placeKey(q) === k || ` ${placeKey(q)} `.includes(` ${k} `));
			if (coveredBy >= 0) continue;
			// A new, more specific place replaces a vaguer one it contains.
			const covers = list.findIndex((q) => ` ${k} `.includes(` ${placeKey(q)} `));
			if (covers >= 0) list[covers] = p;
			else list.push(p);
		}
		return list.join(" / ");
	}

	const api = { rangesFromText, rangesFromJsonLd, formatRanges, locationsFromText, mergeLocations };
	if (typeof module !== "undefined") module.exports = api;
	else globalThis.JobCompParser = api;
})();
