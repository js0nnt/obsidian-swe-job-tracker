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

/** A column slot in the layout: a real node, or a placeholder for a link passing through. */
interface LayoutItem {
	node?: SankeyNode;
	layer: number;
	value: number;
	height: number;
	rank: number;
	key: string;
	y: number;
}

/** One column-to-column segment of a link. */
interface Hop {
	link: SankeyLink;
	from: LayoutItem;
	to: LayoutItem;
	fromOffset: number;
	toOffset: number;
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

		const layerGroups = new Map<number, string[]>();
		for (const [id, layer] of layers.entries()) {
			if (!layerGroups.has(layer)) layerGroups.set(layer, []);
			layerGroups.get(layer)!.push(id);
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
		// A root node (e.g. Applied) keeps its full bar, but the part for applications still waiting
		// (no outcome yet) is compressed so it cannot dwarf the outcome ribbons. Its label keeps the full count.
		const WAITING_SHARE = 0.6;
		const rootOutSum = (id: string): number =>
			(incomingMap.get(id) || []).length ? 0 : (outgoingMap.get(id) || []).reduce((sum, link) => sum + link.value, 0);
		const heightUnits = (id: string): number => {
			const value = nodeMap.get(id)!.value;
			const outSum = rootOutSum(id);
			if (outSum === 0) return value;
			return outSum + Math.min(Math.max(value - outSum, 0), outSum * WAITING_SHARE);
		};
		const tallest = Math.max(1, ...Array.from(nodeMap.keys(), heightUnits));
		const pixelsPerUnit = Math.min(24, usableHeight / tallest);
		const nodeWidth = options.spacing === "compact" ? 12 : 18;
		const columnX = (layer: number) => maxLayer === 0 ? (baseWidth - nodeWidth) / 2 : paddingLeft + layer * layerXStep;

		// Layered layout: a link that skips columns gets an invisible placeholder in each column
		// it crosses, so those columns reserve room for it instead of letting it cut through nodes.
		const columns: LayoutItem[][] = Array.from({ length: maxLayer + 1 }, () => []);
		const itemById = new Map<string, LayoutItem>();
		for (const node of nodeMap.values()) {
			node.height = heightUnits(node.id) * pixelsPerUnit;
			const item: LayoutItem = { node, layer: node.layer, value: node.value, height: node.height, rank: getStageRank(node.id), key: node.id, y: 0 };
			itemById.set(node.id, item);
			columns[node.layer].push(item);
		}
		const hops: Hop[] = [];
		const linkHops = new Map<SankeyLink, Hop[]>();
		const hopsIn = new Map<LayoutItem, Hop[]>();
		const hopsOut = new Map<LayoutItem, Hop[]>();
		links.forEach((link, index) => {
			const chain = [itemById.get(link.source)!];
			const target = itemById.get(link.target)!;
			for (let layer = chain[0].layer + 1; layer < target.layer; layer++) {
				const placeholder: LayoutItem = { layer, value: link.value, height: link.value * pixelsPerUnit, rank: target.rank, key: `${index}:${layer}`, y: 0 };
				columns[layer].push(placeholder);
				chain.push(placeholder);
			}
			chain.push(target);
			const chainHops = chain.slice(1).map((to, i): Hop => ({ link, from: chain[i], to, fromOffset: 0, toOffset: 0 }));
			for (const hop of chainHops) {
				if (!hopsOut.has(hop.from)) hopsOut.set(hop.from, []);
				hopsOut.get(hop.from)!.push(hop);
				if (!hopsIn.has(hop.to)) hopsIn.set(hop.to, []);
				hopsIn.get(hop.to)!.push(hop);
			}
			hops.push(...chainHops);
			linkHops.set(link, chainHops);
		});

		// Order each column to minimize crossings (weighted barycenter sweeps). Ties keep the
		// initial order, so larger flows sit on top and progression stages precede drop-offs.
		for (const column of columns) column.sort((a, b) => b.value - a.value || a.rank - b.rank || a.key.localeCompare(b.key));
		const position = new Map<LayoutItem, number>();
		const reindex = (column: LayoutItem[]) => column.forEach((item, i) => position.set(item, i));
		columns.forEach(reindex);
		const sweep = (layer: number, neighbors: Map<LayoutItem, Hop[]>, end: "from" | "to") => {
			const column = columns[layer];
			const barycenter = new Map<LayoutItem, number>();
			for (const item of column) {
				const adjacent = neighbors.get(item) || [];
				const weight = adjacent.reduce((sum, hop) => sum + hop.link.value, 0);
				barycenter.set(item, weight ? adjacent.reduce((sum, hop) => sum + position.get(hop[end])! * hop.link.value, 0) / weight : position.get(item)!);
			}
			column.sort((a, b) => barycenter.get(a)! - barycenter.get(b)! || position.get(a)! - position.get(b)!);
			reindex(column);
		};
		const countCrossings = () => {
			let total = 0;
			for (let i = 0; i < hops.length; i++) {
				for (let j = i + 1; j < hops.length; j++) {
					const a = hops[i], b = hops[j];
					if (a.from.layer !== b.from.layer || a.to.layer !== b.to.layer) continue;
					const order = (position.get(a.from)! - position.get(b.from)!) * (position.get(a.to)! - position.get(b.to)!);
					if (order < 0) total += a.link.value * b.link.value;
				}
			}
			return total;
		};
		for (let layer = 1; layer <= maxLayer; layer++) sweep(layer, hopsIn, "from");
		let best = { crossings: countCrossings(), columns: columns.map(column => [...column]) };
		for (let pass = 0; pass < 4 && best.crossings > 0; pass++) {
			for (let layer = maxLayer - 1; layer >= 0; layer--) sweep(layer, hopsOut, "to");
			for (let layer = 1; layer <= maxLayer; layer++) sweep(layer, hopsIn, "from");
			const crossings = countCrossings();
			if (crossings < best.crossings) best = { crossings, columns: columns.map(column => [...column]) };
		}
		best.columns.forEach((column, layer) => { columns[layer] = column; reindex(column); });

		// Stack ribbon ends by the position of the node on their other side, so ribbons
		// sharing a node never cross each other at that node.
		for (const outs of hopsOut.values()) {
			outs.sort((a, b) => position.get(a.to)! - position.get(b.to)!);
			outs.reduce((offset, hop) => (hop.fromOffset = offset) + hop.link.value * pixelsPerUnit, 0);
		}
		for (const ins of hopsIn.values()) {
			ins.sort((a, b) => position.get(a.from)! - position.get(b.from)!);
			ins.reduce((offset, hop) => (hop.toOffset = offset) + hop.link.value * pixelsPerUnit, 0);
		}

		// Place each item where its incoming ribbons arrive flat, then push down to resolve
		// collisions. Real nodes keep extra clearance for their labels; placeholders pack tighter.
		const labelGap = Math.max(nodeGap, 42);
		for (const column of columns) {
			let previous: LayoutItem | null = null;
			for (const item of column) {
				const ins = hopsIn.get(item) || [];
				const weight = ins.reduce((sum, hop) => sum + hop.link.value, 0);
				const ideal = weight ? ins.reduce((sum, hop) => sum + (hop.from.y + hop.fromOffset - hop.toOffset) * hop.link.value, 0) / weight : paddingY;
				const floor = previous ? previous.y + previous.height + (previous.node || item.node ? labelGap : 6) : paddingY;
				item.y = Math.max(floor, ideal);
				if (item.node) {
					item.node.x = columnX(item.layer);
					item.node.y = item.y;
				}
				previous = item;
			}
		}

		// 4. Expand canvas height dynamically if needed to ensure zero clipping
		for (const column of columns) {
			for (const item of column) baseHeight = Math.max(baseHeight, item.y + item.height + paddingY);
		}

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

			// Curve between columns and run straight across each placeholder column.
			const thickness = link.value * pixelsPerUnit;
			const chain = linkHops.get(link)!;
			let topEdge = "";
			const bottomEdge: string[] = [];
			for (const [i, hop] of chain.entries()) {
				const hx0 = columnX(hop.from.layer) + nodeWidth;
				const hy0 = hop.from.y + hop.fromOffset;
				const hx1 = columnX(hop.to.layer);
				const hy1 = hop.to.y + hop.toOffset;
				const cx0 = hx0 + (hx1 - hx0) * 0.45;
				const cx1 = hx1 - (hx1 - hx0) * 0.45;
				topEdge += `${i === 0 ? "M" : "L"} ${hx0} ${hy0} C ${cx0} ${hy0}, ${cx1} ${hy1}, ${hx1} ${hy1} `;
				bottomEdge.unshift(`L ${hx1} ${hy1 + thickness} C ${cx1} ${hy1 + thickness}, ${cx0} ${hy0 + thickness}, ${hx0} ${hy0 + thickness}`);
			}
			const pathData = `${topEdge}${bottomEdge.join(" ")} Z`;
			const x0 = columnX(sourceNode.layer) + nodeWidth;
			const y0 = sourceNode.y + chain[0].fromOffset;
			const x1 = targetNode.x;
			const y1 = targetNode.y + chain[chain.length - 1].toOffset;

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

			// The compressed "still waiting" part of a root bar is shaded and labelled so it reads as pending.
			const outSum = rootOutSum(node.id);
			const waiting = outSum > 0 ? node.value - outSum : 0;
			const usedHeight = outSum * pixelsPerUnit;
			if (waiting > 0 && node.height > usedHeight) {
				g.createSvg("rect", {
					attr: {
						x: `${node.x}`, y: `${node.y + usedHeight}`,
						width: `${node.width}`, height: `${node.height - usedHeight}`,
						fill: "var(--background-primary, #1e1e1e)", "fill-opacity": "0.55",
						stroke: "var(--text-faint, #888)", "stroke-dasharray": "3 2", "stroke-width": "1",
					},
				});
				const waitText = g.createSvg("text", {
					attr: {
						x: `${node.x + node.width + 8}`, y: `${node.y + usedHeight + (node.height - usedHeight) / 2 + 4}`,
						"font-size": "11px", fill: "var(--text-muted, #999)", "text-anchor": "start",
					},
				});
				waitText.textContent = `${waiting} waiting`;
			}

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
