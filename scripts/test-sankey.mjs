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
	addEventListener(type, callback) {
		const previous = this.events[type];
		this.events[type] = event => { previous?.(event); callback(event); };
	}
	getScreenCTM() { return { a: 2, d: 2, inverse: () => ({ a: 0.5, d: 0.5 }) }; }
	setPointerCapture(id) { this.capture = id; }
	hasPointerCapture(id) { return this.capture === id; }
	releasePointerCapture() { this.capture = null; }
	querySelector(tag) { return this.all(tag)[0]; }
	all(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.all(tag)]); }
}

async function loadModule(path) {
	const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "cjs", external: ["obsidian"] });
	const module = { exports: {} };
	runInNewContext(outputFiles[0].text, { module, exports: module.exports, crypto: webcrypto, AbortController, DOMPoint: class { constructor(x,y) { this.x=x; this.y=y; } matrixTransform(m) { return { x:this.x*m.a, y:this.y*m.d }; } }, require: () => ({ Modal: class {} }) });
	return module.exports;
}

const { renderSankeyDiagram } = await loadModule("src/views/SankeyDiagram.ts");
const { normalizeSankeySettings, DEFAULT_SANKEY_SETTINGS } = await loadModule("src/sankeySettings.ts");
assert.equal(JSON.stringify(normalizeSankeySettings(null)), JSON.stringify(DEFAULT_SANKEY_SETTINGS));
assert.equal(normalizeSankeySettings({ palette: "invalid", opacity: NaN }).palette, "reference");
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
for (const palette of ["reference", "classic", "aurora", "sunset", "ocean"]) {
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
				assert.ok(text.includes("Offer"));
				if (labels !== "names") assert.ok(text.includes(labels === "counts" ? "2" : "20%"));
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

// A link that skips a column must route around the nodes in that column, not through them.
renderSankeyDiagram(container, [
	{ source: "Applied", target: "OA", value: 9 },
	{ source: "Applied", target: "Rejected", value: 21 },
	{ source: "OA", target: "Recruiter Screen", value: 4 },
	{ source: "OA", target: "Withdrawn", value: 3 },
	{ source: "Recruiter Screen", target: "Rejected", value: 1 },
], 166, {}, new Map([["Applied", 166]]));
const skipping = container.all("path").find(path => path.attributes["data-source"] === "Applied" && path.attributes["data-target"] === "Rejected");
const points = [...skipping.attributes.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => ({ x: +x, y: +y }));
for (const id of ["OA", "Recruiter Screen", "Withdrawn"]) {
	const rect = container.all("g").find(g => g.attributes["data-node-id"] === id).all("rect")[0].attributes;
	const [left, top] = [+rect.x, +rect.y];
	const [right, bottom] = [left + +rect.width, top + +rect.height];
	const inColumn = points.filter(p => p.x >= left && p.x <= right).map(p => p.y);
	assert.ok(inColumn.length > 0 && (inColumn.every(y => y <= top) || inColumn.every(y => y >= bottom)), `Applied → Rejected must not pass through ${id}`);
}
console.log("Passed multi-column link routing around intermediate nodes.");

const { MetricsRenderer } = await loadModule("src/views/renderers/MetricsRenderer.ts");
const applications = [
	{ source: "LinkedIn", stages: ["Applied"] },
	{ source: "Referral", stages: ["Applied", "Offer"] },
	{ stages: ["Applied", "Rejected"] },
];
const metrics = new MetricsRenderer({
	applications,
	plugin: { settings: { sankey: DEFAULT_SANKEY_SETTINGS } },
	getVisitedStatuses: app => app.stages,
});
metrics.renderSankeyDiagram(container);
const nodeLabels = container.all("title").map(node => node.textContent);
assert.ok(!nodeLabels.some(label => label.includes("All applications")));
assert.ok(nodeLabels.includes("Applied: 3 applications"));
assert.ok(nodeLabels.includes("Offer: 1 application"));
assert.ok(nodeLabels.includes("Rejected: 1 application"));
assert.equal(container.all("path").length, 2);
assert.ok(!nodeLabels.some(label => /LinkedIn|Referral|Direct/.test(label)));
applications.splice(1);
metrics.renderSankeyDiagram(container);
assert.ok(container.all("title").some(node => node.textContent === "Applied: 1 application"));
assert.equal(container.all("path").length, 0);
assert.equal(container.all("rect").length, 1);
applications.push({ stages: ["OA"] });
metrics.renderSankeyDiagram(container);
assert.equal(container.all("rect").length, 2);
assert.ok(container.all("title").some(node => node.textContent === "OA: 1 application"));
assert.equal(container.all("path").length, 0);
console.log("Passed source-independent pipeline counts and applications without stage transitions.");

// Viewport regression checks use a known 2px-per-SVG-unit screen transform.
const svg = container.all("svg")[0];
const initial = svg.attributes.viewBox;
const [initialX, initialY, width, height] = initial.split(" ").map(Number);
const buttons = container.all("button");
const click = label => buttons.find(button => button.attributes["aria-label"] === label).events.click();
const box = () => svg.attributes.viewBox.split(" ").map(Number);
click("Zoom in");
assert.equal(box()[2], width / 1.25);
click("Center in view");
assert.equal(svg.attributes.viewBox, initial);
svg.events.pointerdown({ button: 0, pointerId: 1, clientX: 0, clientY: 0 });
svg.events.pointermove({ pointerId: 1, clientX: 80, clientY: 40 });
assert.equal(box()[0], -40);
assert.equal(box()[1], -20);
svg.events.pointercancel({ pointerId: 1 });
assert.equal(svg.classList.contains("is-panning"), false);
const afterDrag = svg.attributes.viewBox;
svg.events.pointermove({ pointerId: 1, clientX: 180, clientY: 140 });
assert.equal(svg.attributes.viewBox, afterDrag);
click("Center in view");
svg.events.wheel({ clientX: 100, clientY: 60, deltaY: -100, deltaMode: 0, preventDefault() {} });
const zoom = width / box()[2];
assert.ok(Math.abs((50 - box()[0]) * zoom - 50) < 1e-8, "Zoom anchor must stay under cursor");
for (let i=0;i<30;i++) click("Zoom in");
assert.equal(box()[2], width / 5);
for (let i=0;i<40;i++) click("Zoom out");
assert.equal(box()[2], width / 0.25);
svg.events.keydown({ target: svg, key: "Home", preventDefault() {} });
assert.equal(svg.attributes.viewBox, initial);
console.log("Passed zoom limits, pointer-anchored zoom, dragging, cancellation, and centering.");
