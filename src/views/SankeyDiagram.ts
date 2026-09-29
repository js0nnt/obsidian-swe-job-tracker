import { attachSankeyViewport } from "./SankeyViewport";
import { StageCategory, getStageRank as stageRank, matchStage } from "../stages";
import { SankeySettings, normalizeSankeySettings } from "../sankeySettings";

const PALETTES = {
	reference: ["#199e80", "#d76700", "#e4ad00", "#69a51d", "#1d9f80", "#82ac4d", "#8072b2", "#dfaf08", "#e3258c"],
	aurora: ["#8b5cf6", "#a78bfa", "#38bdf8", "#2dd4bf", "#34d399", "#10b981", "#f472b6", "#c084fc", "#94a3b8"],
	sunset: ["#f97316", "#fb923c", "#fbbf24", "#fb7185", "#e879f9", "#a78bfa", "#e11d48", "#c084fc", "#a8a29e"],
	ocean: ["#0284c7", "#38bdf8", "#22d3ee", "#2dd4bf", "#34d399", "#059669", "#818cf8", "#a78bfa", "#94a3b8"],
};

function paletteColor(id: string, palette: SankeySettings["palette"]): string {
	if (palette === "classic") return getNodeColor(id);
	const colors = PALETTES[palette];
	const stage = matchStage(id);
	if (palette === "reference" && /^Round \d+$/i.test(id)) {
		const round = Number(id.match(/\d+/)?.[0] || 1);
		return ["#d76700", "#69a51d", "#aa7b20", "#747474", "#c28d47", "#8072b2"][(round - 1) % 6];
	}
	if (stage) return colors[Object.keys(STAGE_COLORS).indexOf(stage)];
	let hash = 0;
	for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return colors[Math.abs(hash) % colors.length];
}

/**
 * Native SVG Sankey Diagram Renderer for Obsidian Job Application Tracker.
 * Renders pure SVG DOM elements without external dependencies or security prompts.
 */

export interface SankeyLink {
	source: string;
	target: string;
	value: number;
}

export interface SankeyNode {
	id: string;
	label: string;
	layer: number;
	value: number;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
}

const STAGE_COLORS: Record<StageCategory, string> = {
	applied: "var(--job-status-applied)",
	oa: "var(--job-status-oa)",
	screen: "var(--job-status-recruiter-screen)",
	interview: "var(--job-status-interview)",
	offer: "var(--job-status-offer)",
	accepted: "var(--job-status-accepted)",
	rejected: "var(--job-status-rejected)",
	withdrawn: "var(--job-status-withdrawn)",
	ghosted: "var(--job-status-ghosted)",
};

export function getNodeColor(id: string): string {
	const stage = matchStage(id);
	if (stage) return STAGE_COLORS[stage];

	// Source colors based on hash/palette
	const sourcePalette = [
		"#3b82f6",
		"#8b5cf6",
		"#ec4899",
		"#06b6d4",
		"#10b981",
		"#f59e0b",
		"#6366f1",
		"#14b8a6",
	];
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash << 5) - hash + id.charCodeAt(i);
	}
	return sourcePalette[Math.abs(hash) % sourcePalette.length];
}

/**
 * Canonical rank for stages: positive progression at the top (lower values),
 * and terminal drop-offs/outcomes at the bottom (>= 100). Sources rank as custom (80).
 */
export function getStageRank(id: string): number {
	return matchStage(id) ? stageRank(id) : 80;
}

/**
 * Formats and safely truncates display text labels for diagram nodes.
 */
export function formatDisplayLabel(rawLabel: string, value: number, maxChars = 22): string {
	let clean = (rawLabel || "").trim();
	if (clean.includes(": ")) {
		const parts = clean.split(": ");
		clean = parts[parts.length - 1].trim();
	}
	const displayStr = clean.length > maxChars ? clean.slice(0, maxChars - 1) + "…" : clean;
	return `${displayStr} (${value})`;
}

/**
 * Renders a complete interactive Sankey SVG into the provided container.
 */
export function renderSankeyDiagram(container: HTMLElement, links: SankeyLink[], totalApps: number, preferences?: Partial<SankeySettings>, stageCounts: ReadonlyMap<string, number> = new Map()): void {
		const options = normalizeSankeySettings(preferences);
		container.classList.toggle("has-grid", options.showGrid);
		const displayLabel = (label: string, value: number): string => {
			const name = formatDisplayLabel(label, value).replace(/ \(\d+\)$/, "");
			if (options.labels === "names") return name;
			if (options.labels === "percentages") return `${name} (${totalApps > 0 ? Math.round(value / totalApps * 100) : 0}%)`;
			return formatDisplayLabel(label, value);
		};
		const prevController = (container as unknown as { _sankeyAbort?: AbortController })._sankeyAbort;
		if (prevController) {
			prevController.abort();
		}
		const abortController = new AbortController();
		(container as unknown as { _sankeyAbort?: AbortController })._sankeyAbort = abortController;
		const { signal } = abortController;

		container.empty();

		if ((links.length === 0 && stageCounts.size === 0) || totalApps === 0) {
			container.createEl("p", {
				text: "No application flow data available yet.",
				cls: "text-muted",
			});
			return;
		}

		// 1. Collect all unique nodes
		const nodeMap = new Map<string, SankeyNode>();
		const outgoingMap = new Map<string, SankeyLink[]>();
		const incomingMap = new Map<string, SankeyLink[]>();

		for (const link of links) {
			if (!outgoingMap.has(link.source)) outgoingMap.set(link.source, []);
			outgoingMap.get(link.source)!.push(link);

			if (!incomingMap.has(link.target)) incomingMap.set(link.target, []);
			incomingMap.get(link.target)!.push(link);
		}

		const allNodeIds = new Set<string>(stageCounts.keys());
		for (const link of links) {
			allNodeIds.add(link.source);
			allNodeIds.add(link.target);
		}

		// 2. Assign layer/column using topological depth
		const layers = new Map<string, number>();

		// Find root nodes (no incoming links)
		const roots: string[] = [];
		for (const id of allNodeIds) {
			if (!incomingMap.has(id) || incomingMap.get(id)!.length === 0) {
				roots.push(id);
			}
		}

		// Fallback if all have incoming (should not happen in DAG)
		if (roots.length === 0 && allNodeIds.size > 0) {
			roots.push(Array.from(allNodeIds)[0]);
		}

		// BFS to assign layers
		const queue: { id: string; layer: number }[] = roots.map((r) => ({ id: r, layer: 0 }));
		for (const r of roots) layers.set(r, 0);

		let iterations = 0;
		const maxIterations = Math.max(100, allNodeIds.size * 3);

		while (queue.length > 0 && iterations++ < maxIterations) {
			const { id, layer } = queue.shift()!;
			// Skip stale queue items if node was already advanced to a higher layer
			if ((layers.get(id) || 0) > layer) continue;

			const outs = outgoingMap.get(id) || [];
			for (const link of outs) {
				const prevLayer = layers.get(link.target) ?? -1;
				const nextLayer = Math.max(prevLayer, layer + 1);
				if (nextLayer > prevLayer) {
					layers.set(link.target, nextLayer);
					queue.push({ id: link.target, layer: nextLayer });
				}
			}
		}

		// Ensure all node IDs are assigned a layer (default to 0 if unreachable from roots)
		for (const id of allNodeIds) {
			if (!layers.has(id)) {
				layers.set(id, 0);
			}
		}

		const maxLayer = Array.from(layers.values()).reduce((max, v) => Math.max(max, v), 0);

		// Group and sort nodes by layer to separate progression paths from drop-offs
		const layerGroups = new Map<number, string[]>();
		for (const [id, layer] of layers.entries()) {
			if (!layerGroups.has(layer)) layerGroups.set(layer, []);
			layerGroups.get(layer)!.push(id);
		}

		for (let layer = 0; layer <= maxLayer; layer++) {
			const nodeIds = layerGroups.get(layer) || [];
			if (layer === 0) {
				// Sources: sort primarily by min target stage rank (e.g. Applied=20 before OA=30)
				// secondary by volume descending
				nodeIds.sort((a, b) => {
					const outsA = outgoingMap.get(a) || [];
					const outsB = outgoingMap.get(b) || [];
					const minRankA = outsA.reduce((min, l) => Math.min(min, SankeyDiagram.getStageRank(l.target)), 999);
					const minRankB = outsB.reduce((min, l) => Math.min(min, SankeyDiagram.getStageRank(l.target)), 999);
					if (minRankA !== minRankB) return minRankA - minRankB;
					const valA = outsA.reduce((acc, l) => acc + l.value, 0);
					const valB = outsB.reduce((acc, l) => acc + l.value, 0);
					if (valB !== valA) return valB - valA;
					return a.localeCompare(b);
				});
			} else {
				// Stages: sort by stage rank (positive progression on top, terminal drop-offs on bottom)
				nodeIds.sort((a, b) => {
					const rankA = SankeyDiagram.getStageRank(a);
					const rankB = SankeyDiagram.getStageRank(b);
					if (rankA !== rankB) return rankA - rankB;
					const valA = (outgoingMap.get(a) || []).reduce((acc, l) => acc + l.value, 0);
					const valB = (outgoingMap.get(b) || []).reduce((acc, l) => acc + l.value, 0);
					if (valB !== valA) return valB - valA;
					return a.localeCompare(b);
				});
			}
		}

		// Explicit stage counts include applications still waiting at a stage with no outgoing flow.
		for (const id of allNodeIds) {
			const inSum = (incomingMap.get(id) || []).reduce((acc, l) => acc + l.value, 0);
			const outSum = (outgoingMap.get(id) || []).reduce((acc, l) => acc + l.value, 0);
			const val = Math.max(stageCounts.get(id) || 0, inSum, outSum, 1);
			nodeMap.set(id, {
				id,
				label: id,
				layer: layers.get(id) || 0,
				value: val,
				x: 0,
				y: 0,
				width: options.spacing === "compact" ? 12 : 18,
				height: 0,
				color: paletteColor(id, options.palette),
			});
		}

		// 3. Geometry & Layout Coordinates
		// Dynamically compute left and right padding based on actual label lengths to ensure labels never clip
		const leftNodeIds = layerGroups.get(0) || [];
		const rightNodeIds = layerGroups.get(maxLayer) || [];

		const maxLeftChars = leftNodeIds.reduce((max, id) => {
			const n = nodeMap.get(id);
			return Math.max(max, displayLabel(n?.label || id, n?.value || 0).length);
		}, 10);

		const maxRightChars = rightNodeIds.reduce((max, id) => {
			const n = nodeMap.get(id);
			return Math.max(max, displayLabel(n?.label || id, n?.value || 0).length);
		}, 10);

		const paddingLeft = Math.max(120, Math.min(220, Math.ceil(maxLeftChars * 7.5) + 24));
		const paddingRight = Math.max(120, Math.min(220, Math.ceil(maxRightChars * 7.5) + 24));
		const paddingY = 24;
		const nodeGap = { compact: 14, comfortable: 26, airy: 42 }[options.spacing];

		const columnWidth = { compact: 150, comfortable: 190, airy: 240 }[options.spacing];
		const baseWidth = Math.max(800, maxLayer * columnWidth + paddingLeft + paddingRight);
		let baseHeight = Math.max(280, baseWidth * 0.32);

		const usableWidth = baseWidth - paddingLeft - paddingRight;
		const usableHeight = baseHeight - paddingY * 2;
		const layerXStep = maxLayer > 0 ? usableWidth / maxLayer : usableWidth;

		// One shared scale keeps every application's ribbon equally thick across stages.
		const pixelsPerUnit = Math.min(24, usableHeight / Math.max(totalApps, 1));
		for (const node of nodeMap.values()) node.height = node.value * pixelsPerUnit;
		// Place later stages near the center of their incoming flow, then resolve collisions.
		// Large outcomes rise to the top while smaller progression branches cascade below.
		for (let layer = 0; layer <= maxLayer; layer++) {
			const ids = layerGroups.get(layer) || [];
			ids.sort((a, b) => nodeMap.get(b)!.value - nodeMap.get(a)!.value || a.localeCompare(b));
			let bottom = paddingY;
			for (const id of ids) {
				const node = nodeMap.get(id)!;
				const incoming = incomingMap.get(id) || [];
				const weight = incoming.reduce((sum, link) => sum + link.value, 0);
				const center = weight ? incoming.reduce((sum, link) => {
					const parent = nodeMap.get(link.source)!;
					return sum + (parent.y + parent.height / 2) * link.value;
				}, 0) / weight : paddingY + node.height / 2;
				node.x = maxLayer === 0 ? (baseWidth - node.width) / 2 : paddingLeft + layer * layerXStep;
				node.y = Math.max(bottom, center - node.height / 2);
				bottom = node.y + node.height + Math.max(nodeGap, 42);
			}
		}

		// 3. Pre-compute link port offsets sorted by target/source vertical positions
		const sourceLinkOffsets = new Map<SankeyLink, number>();
		const targetLinkOffsets = new Map<SankeyLink, number>();
		const sourceLinkHeights = new Map<SankeyLink, number>();
		const targetLinkHeights = new Map<SankeyLink, number>();

		// Outgoing links:
		// 1. Sort by target layer ascending (links to earlier stages like Applied exit higher)
		// 2. Secondary sort by target node y position ascending
		for (const [nodeId, outLinks] of outgoingMap.entries()) {
			const srcNode = nodeMap.get(nodeId);
			if (!srcNode) continue;
			outLinks.sort((a, b) => {
				const tgtA = nodeMap.get(a.target);
				const tgtB = nodeMap.get(b.target);
				const layerA = tgtA ? tgtA.layer : 0;
				const layerB = tgtB ? tgtB.layer : 0;
				if (layerA !== layerB) {
					return layerA - layerB; // Earlier stage exits higher
				}
				const yA = tgtA ? tgtA.y : 0;
				const yB = tgtB ? tgtB.y : 0;
				if (yA !== yB) {
					return yA - yB;
				}
				return a.target.localeCompare(b.target);
			});
			let sOffset = 0;
			for (const link of outLinks) {
				const h = link.value * pixelsPerUnit;
				sourceLinkHeights.set(link, h);
				sourceLinkOffsets.set(link, sOffset);
				sOffset += h;
			}
		}

		// Incoming links:
		// 1. Sort by source layer descending (links from closer stages like Applied enter higher)
		// 2. Secondary sort by source node y position ascending
		for (const [nodeId, inLinks] of incomingMap.entries()) {
			const tgtNode = nodeMap.get(nodeId);
			if (!tgtNode) continue;
			inLinks.sort((a, b) => {
				const srcA = nodeMap.get(a.source);
				const srcB = nodeMap.get(b.source);
				const layerA = srcA ? srcA.layer : 0;
				const layerB = srcB ? srcB.layer : 0;
				if (layerA !== layerB) {
					return layerB - layerA; // Closer stage enters higher
				}
				const yA = srcA ? srcA.y : 0;
				const yB = srcB ? srcB.y : 0;
				if (yA !== yB) {
					return yA - yB;
				}
				return a.source.localeCompare(b.source);
			});
			let tOffset = 0;
			for (const link of inLinks) {
				const h = link.value * pixelsPerUnit;
				targetLinkHeights.set(link, h);
				targetLinkOffsets.set(link, tOffset);
				tOffset += h;
			}
		}

		// 4. Expand canvas height dynamically if needed to ensure zero clipping
		let maxTotalHeight = baseHeight;
		for (const n of nodeMap.values()) {
			maxTotalHeight = Math.max(maxTotalHeight, n.y + n.height + paddingY);
		}

		baseHeight = maxTotalHeight;

		// 5. Build SVG with Obsidian's createSvg helper
		const svg = container.createSvg("svg", {
			cls: "job-tracker-native-sankey-svg",
			attr: {
				viewBox: `0 0 ${baseWidth} ${baseHeight}`,
				preserveAspectRatio: "xMidYMid meet",
				role: "group",
				"aria-label": "Sankey diagram showing job application pipeline flow",
			},
		});

		// Definitions for gradients & filters
		attachSankeyViewport(container, svg, baseWidth, baseHeight, signal);

		const defs = svg.createSvg("defs");

		// Draw Links (Ribbons)
		const linksGroup = svg.createSvg("g", { cls: "job-tracker-sankey-links" });

		// Sort links so longer multi-layer jumps render beneath immediate transitions
		const sortedLinks = [...links].sort((a, b) => {
			const srcA = nodeMap.get(a.source);
			const tgtA = nodeMap.get(a.target);
			const srcB = nodeMap.get(b.source);
			const tgtB = nodeMap.get(b.target);
			const spanA = tgtA && srcA ? tgtA.layer - srcA.layer : 1;
			const spanB = tgtB && srcB ? tgtB.layer - srcB.layer : 1;
			if (spanB !== spanA) return spanB - spanA; // Longer span in the back
			return b.value - a.value; // Larger value in the back
		});

		const allRibbonEls: { el: SVGPathElement; link: SankeyLink }[] = [];
		const allNodeEls: { el: SVGGElement; id: string }[] = [];

		for (const link of sortedLinks) {
			const sourceNode = nodeMap.get(link.source);
			const targetNode = nodeMap.get(link.target);
			if (!sourceNode || !targetNode) continue;

			const sOffset = sourceLinkOffsets.get(link) || 0;
			const tOffset = targetLinkOffsets.get(link) || 0;
			const sourceLinkHeight = sourceLinkHeights.get(link) || 4;
			const targetLinkHeight = targetLinkHeights.get(link) || 4;

			const x0 = sourceNode.x + sourceNode.width;
			const y0 = sourceNode.y + sOffset;
			const x1 = targetNode.x;
			const y1 = targetNode.y + tOffset;

			const cx0 = x0 + (x1 - x0) * 0.45;
			const cx1 = x1 - (x1 - x0) * 0.45;
			const pathData = `M ${x0} ${y0}
				C ${cx0} ${y0}, ${cx1} ${y1}, ${x1} ${y1}
				L ${x1} ${y1 + targetLinkHeight}
				C ${cx1} ${y1 + targetLinkHeight}, ${cx0} ${y0 + sourceLinkHeight}, ${x0} ${y0 + sourceLinkHeight} Z`;

			// Create linear gradient for link
			const gradId = `sankey-grad-${crypto.randomUUID()}`;
			const grad = defs.createSvg("linearGradient", {
				attr: {
					id: gradId,
					gradientUnits: "userSpaceOnUse",
					x1: `${x0}`,
					y1: `${y0}`,
					x2: `${x1}`,
					y2: `${y1}`,
				},
			});

			grad.createSvg("stop", {
				attr: {
					offset: "0%",
					"stop-color": options.flowStyle === "target" ? targetNode.color : sourceNode.color,
					"stop-opacity": `${options.opacity / 100}`,
				},
			});

			grad.createSvg("stop", {
				attr: {
					offset: "100%",
					"stop-color": options.flowStyle === "source" ? sourceNode.color : targetNode.color,
					"stop-opacity": `${options.opacity / 100}`,
				},
			});

			const path = linksGroup.createSvg("path", {
				cls: "job-tracker-sankey-ribbon",
				attr: {
					d: pathData,
					fill: `url(#${gradId})`,
					"data-source": link.source,
					"data-target": link.target,
				},
			});

			const cleanSource = link.source.includes(": ") ? link.source.split(": ").pop()! : link.source;
			const cleanTarget = link.target.includes(": ") ? link.target.split(": ").pop()! : link.target;
			const linkTitle = path.createSvg("title");
			linkTitle.textContent = `${cleanSource} → ${cleanTarget}: ${link.value} application${link.value === 1 ? "" : "s"}`;

			allRibbonEls.push({ el: path, link });
		}

		// Draw Nodes
		const nodesGroup = svg.createSvg("g", { cls: "job-tracker-sankey-nodes" });

		for (const node of nodeMap.values()) {
			const g = nodesGroup.createSvg("g", {
				cls: "job-tracker-sankey-node",
				attr: {
					"data-node-id": node.id,
				},
			});

			allNodeEls.push({ el: g, id: node.id });

			// Rect
			g.createSvg("rect", {
				attr: {
					x: `${node.x}`,
					y: `${node.y}`,
					width: `${node.width}`,
					height: `${node.height}`,
					rx: "1",
					ry: "1",
					fill: node.color,
					stroke: "var(--background-primary, #ffffff)",
					"stroke-width": "1",
				},
			});

			// Text Label
			const labelX = String(node.layer === 0 ? node.x - 10 : node.x + node.width + 10);
			const labelY = String(node.y + node.height / 2 + 15);
			const textAnchor = node.layer === 0 ? "end" : "start";
			if (options.labels !== "names") {
				const count = g.createSvg("text", { attr: {
					x: labelX, y: String(node.y + node.height / 2 - 3),
					"text-anchor": textAnchor, "font-size": "25px", fill: "var(--text-normal)",
				} });
				count.textContent = options.labels === "percentages" ? `${Math.round(node.value / totalApps * 100)}%` : String(node.value);
			}

			const labelText = g.createSvg("text", {
				attr: {
					"font-size": "11px",
					"font-family": "var(--font-default, sans-serif)",
					fill: "var(--text-normal, #dcddde)",
					"font-weight": "500",
					x: labelX,
					y: labelY,
					"text-anchor": textAnchor,
				},
			});
			labelText.textContent = formatDisplayLabel(node.label, node.value).replace(/ \(\d+\)$/, "");

			const cleanNodeLabel = node.label.includes(": ") ? node.label.split(": ").pop()! : node.label;
			const nodeTitle = g.createSvg("title");
			nodeTitle.textContent = `${cleanNodeLabel}: ${node.value} application${node.value === 1 ? "" : "s"}`;
		}

		// 5. Interactive Focus Mode: highlight hovered flows and dim unrelated paths
		let isFocused = false;

		const resetFocus = () => {
			if (!isFocused) return;
			isFocused = false;
			for (const r of allRibbonEls) {
				r.el.classList.remove("is-dimmed", "is-highlighted");
			}
			for (const n of allNodeEls) {
				n.el.classList.remove("is-dimmed", "is-highlighted");
			}
		};

		const focusRibbon = (targetEntry: { el: SVGPathElement; link: SankeyLink }) => {
			isFocused = true;
			for (const r of allRibbonEls) {
				if (r === targetEntry) {
					r.el.classList.remove("is-dimmed");
					r.el.classList.add("is-highlighted");
				} else {
					r.el.classList.remove("is-highlighted");
					r.el.classList.add("is-dimmed");
				}
			}

			const activeSource = targetEntry.link.source;
			const activeTarget = targetEntry.link.target;
			for (const n of allNodeEls) {
				if (n.id === activeSource || n.id === activeTarget) {
					n.el.classList.remove("is-dimmed");
					n.el.classList.add("is-highlighted");
				} else {
					n.el.classList.remove("is-highlighted");
					n.el.classList.add("is-dimmed");
				}
			}
		};

		const focusNode = (nodeId: string) => {
			isFocused = true;
			const connectedNodes = new Set<string>([nodeId]);

			for (const r of allRibbonEls) {
				if (r.link.source === nodeId || r.link.target === nodeId) {
					r.el.classList.remove("is-dimmed");
					r.el.classList.add("is-highlighted");
					connectedNodes.add(r.link.source);
					connectedNodes.add(r.link.target);
				} else {
					r.el.classList.remove("is-highlighted");
					r.el.classList.add("is-dimmed");
				}
			}

			for (const n of allNodeEls) {
				if (connectedNodes.has(n.id)) {
					n.el.classList.remove("is-dimmed");
					n.el.classList.add("is-highlighted");
				} else {
					n.el.classList.remove("is-highlighted");
					n.el.classList.add("is-dimmed");
				}
			}
		};

		// Attach focus event listeners without DOM mutations
		for (const r of allRibbonEls) {
			r.el.setAttribute("tabindex", "0");
			r.el.setAttribute("aria-label", r.el.querySelector("title")?.textContent || "Application flow");
			r.el.addEventListener("focus", () => focusRibbon(r), { signal });
			r.el.addEventListener("blur", resetFocus, { signal });
			r.el.addEventListener(
				"pointerenter",
				(e) => {
					e.stopPropagation();
					focusRibbon(r);
				},
				{ signal }
			);
		}

		for (const n of allNodeEls) {
			n.el.setAttribute("tabindex", "0");
			n.el.setAttribute("aria-label", n.el.querySelector("title")?.textContent || n.id);
			n.el.addEventListener("focus", () => focusNode(n.id), { signal });
			n.el.addEventListener("blur", resetFocus, { signal });
			n.el.addEventListener(
				"pointerenter",
				(e) => {
					e.stopPropagation();
					focusNode(n.id);
				},
				{ signal }
			);
		}

		// Fallbacks: automatically reset focus whenever pointer leaves interactive elements or SVG
		svg.addEventListener(
			"pointermove",
			(e) => {
				const target = e.target as Element | null;
				const isOverRibbon = target?.closest(".job-tracker-sankey-ribbon");
				const isOverNode = target?.closest(".job-tracker-sankey-node");
				if (!isOverRibbon && !isOverNode) {
					resetFocus();
				}
			},
			{ signal }
		);

		svg.addEventListener("pointerleave", resetFocus, { signal });
		container.addEventListener("mouseleave", resetFocus, { signal });
}

export const SankeyDiagram = {
	getNodeColor,
	getStageRank,
	formatDisplayLabel,
	render: renderSankeyDiagram,
};
