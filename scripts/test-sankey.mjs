import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";

// Exercise the SVG renderer without requiring an Obsidian process.
class Element {
	constructor(tag = "div", options = {}) {
		this.tag = tag;
		this.children = [];
		this.attributes = { ...options.attr };
		this.textContent = options.text || "";
		this.events = {};
		const classes = new Set((options.cls || "").split(" "));
		this.classList = {
			add: (...names) => names.forEach(name => classes.add(name)),
			remove: (...names) => names.forEach(name => classes.delete(name)),
			toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
			contains: name => classes.has(name),
		};
	}
	empty() { this.children = []; }
	createSvg(tag, options) { const child = new Element(tag, options); this.children.push(child); return child; }
	createEl(tag, options) { return this.createSvg(tag, options); }
	setAttribute(key, value) { this.attributes[key] = value; }
	addEventListener(type, callback) { this.events[type] = callback; }
	querySelector(tag) { return this.all(tag)[0]; }
	all(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.all(tag)]); }
}

async function loadModule(path) {
	const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs" });
	const module = { exports: {} };
	runInNewContext(outputFiles[0].text, { module, exports: module.exports, crypto: webcrypto, AbortController });
	return module.exports;
}

const { renderSankeyDiagram } = await loadModule("src/views/SankeyDiagram.ts");
const { normalizeSankeySettings, DEFAULT_SANKEY_SETTINGS } = await loadModule("src/sankeySettings.ts");
assert.equal(JSON.stringify(normalizeSankeySettings(null)), JSON.stringify(DEFAULT_SANKEY_SETTINGS));
assert.equal(normalizeSankeySettings({ palette: "invalid", opacity: NaN }).palette, "aurora");
assert.equal(normalizeSankeySettings({ opacity: NaN }).opacity, 55);
assert.equal(normalizeSankeySettings({ opacity: 200 }).opacity, 90);
assert.equal(normalizeSankeySettings({ opacity: -10 }).opacity, 15);

const links = [
	{ source: "Referral", target: "Applied", value: 8 },
	{ source: "Company Site", target: "Applied", value: 2 },
	{ source: "Applied", target: "Round 1", value: 5 },
	{ source: "Applied", target: "Rejected", value: 5 },
	{ source: "Round 1", target: "Offer", value: 2 },
	{ source: "Round 1", target: "Rejected", value: 3 },
];
const original = JSON.stringify(links);
const container = new Element();
let cases = 0;
for (const palette of ["classic", "aurora", "sunset", "ocean"]) {
	for (const flowStyle of ["gradient", "source", "target"]) {
		for (const spacing of ["compact", "comfortable", "airy"]) {
			for (const labels of ["counts", "percentages", "names"]) {
				const previous = container._sankeyAbort;
				renderSankeyDiagram(container, links, 10, { palette, flowStyle, spacing, labels, opacity: 70, showGrid: false });
				if (previous) assert.equal(previous.signal.aborted, true);
				assert.equal(container.all("svg").length, 1);
				assert.equal(container.all("path").length, links.length);
				assert.equal(container.all("rect").length, 6);
				assert.equal(container.classList.contains("has-grid"), false);
				assert.ok(container.all("path").every(path => !/NaN|Infinity/.test(path.attributes.d)));
				assert.ok(container.all("stop").every(stop => stop.attributes["stop-opacity"] === "0.7"));
				for (const gradient of container.all("linearGradient")) {
					const stops = gradient.all("stop");
					if (flowStyle !== "gradient") assert.equal(stops[0].attributes["stop-color"], stops[1].attributes["stop-color"]);
				}
				const text = container.all("text").map(element => element.textContent);
				assert.ok(text.includes(labels === "counts" ? "Offer (2)" : labels === "percentages" ? "Offer (20%)" : "Offer"));
				const ribbon = container.all("path")[0];
				assert.equal(ribbon.attributes.tabindex, "0");
				ribbon.events.focus();
				assert.ok(ribbon.classList.contains("is-highlighted"));
				ribbon.events.blur();
				assert.equal(ribbon.classList.contains("is-highlighted"), false);
				cases++;
			}
		}
	}
}
assert.equal(JSON.stringify(links), original, "Styling must not mutate flow data");
renderSankeyDiagram(container, [], 0);
assert.equal(container.all("svg").length, 0);
assert.equal(container.all("p").length, 1);
console.log(`Passed ${cases} Sankey style combinations, settings validation, keyboard focus, redraw cleanup, and empty state.`);
