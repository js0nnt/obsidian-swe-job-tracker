export interface SankeySettings {
	palette: "reference" | "classic" | "aurora" | "sunset" | "ocean";
	flowStyle: "gradient" | "source" | "target";
	spacing: "compact" | "comfortable" | "airy";
	labels: "counts" | "percentages" | "names";
	opacity: number;
	showGrid: boolean;
}

export const DEFAULT_SANKEY_SETTINGS: SankeySettings = {
	palette: "reference",
	flowStyle: "target",
	spacing: "comfortable",
	labels: "counts",
	opacity: 55,
	showGrid: false,
};

/** Validate persisted preferences, including settings from older plugin versions. */
export function normalizeSankeySettings(value: unknown): SankeySettings {
	const raw = value && typeof value === "object" ? value as Partial<SankeySettings> : {};
	const pick = <T extends string>(value: unknown, choices: readonly T[], fallback: T): T =>
		choices.includes(value as T) ? value as T : fallback;
	return {
		palette: pick(raw.palette, ["reference", "classic", "aurora", "sunset", "ocean"], DEFAULT_SANKEY_SETTINGS.palette),
		flowStyle: pick(raw.flowStyle, ["gradient", "source", "target"], DEFAULT_SANKEY_SETTINGS.flowStyle),
		spacing: pick(raw.spacing, ["compact", "comfortable", "airy"], DEFAULT_SANKEY_SETTINGS.spacing),
		labels: pick(raw.labels, ["counts", "percentages", "names"], DEFAULT_SANKEY_SETTINGS.labels),
		opacity: typeof raw.opacity === "number" && Number.isFinite(raw.opacity)
			? Math.min(90, Math.max(15, raw.opacity)) : DEFAULT_SANKEY_SETTINGS.opacity,
		showGrid: typeof raw.showGrid === "boolean" ? raw.showGrid : DEFAULT_SANKEY_SETTINGS.showGrid,
	};
}
