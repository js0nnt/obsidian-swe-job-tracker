import { Notice, Setting, setIcon } from "obsidian";
import { DEFAULT_SANKEY_SETTINGS, SankeySettings } from "../../sankeySettings";
import { getStatusClassName } from "../../constants";
import { SankeyDiagram, SankeyLink } from "../SankeyDiagram";
import { JobTrackerView } from "../JobTrackerView";

/**
 * Renderer for the Analytics & Metrics dashboard, including KPI cards, Sankey flow diagram,
 * stage breakdown progress bars, source conversion tables, and recent activity timeline.
 */
export class MetricsRenderer {
	private view: JobTrackerView;

	constructor(view: JobTrackerView) {
		this.view = view;
	}

	/**
	 * Renders the full statistics and analytics dashboard.
	 */
	render(container: HTMLElement) {
		const metricsContainer = container.createDiv({ cls: "job-tracker-metrics-container" });
		const m = this.view.getOrComputeMetrics();

		// 1. KPI Cards Grid
		const kpiGrid = metricsContainer.createDiv({ cls: "job-tracker-kpi-grid" });

		this.renderKpiCard(kpiGrid, "Total Applications", `${m.totalApps}`, "briefcase", `${m.activeCount} active, ${m.rejectedCount} rejected`);
		this.renderKpiCard(kpiGrid, "Response Rate", `${m.responseRate}%`, "mail", `${m.respondedCount} heard back (incl. rejections)`);
		this.renderKpiCard(kpiGrid, "OA Rate", `${m.oaRate}%`, "code", `${m.oaCount} online assessments received`);
		this.renderKpiCard(kpiGrid, "Interview Rate", `${m.interviewRate}%`, "calendar-check", `${m.interviewCount} reached a recruiter screen or round`);
		this.renderKpiCard(kpiGrid, "Offers", `${m.offerCount}`, "award", `${m.offerRate}% of applications, ${m.acceptedCount} accepted`);
		this.renderKpiCard(kpiGrid, "Interviews Logged", `${m.totalInterviews}`, "clock", `${m.completedInterviews} completed rounds`);
		this.renderKpiCard(kpiGrid, "Contacts", `${m.totalContacts}`, "users", "Recruiters, referrers & engineers");

		// 2. Section: Sankey Pipeline Flow Diagram
		const sankeySection = metricsContainer.createDiv({ cls: "job-tracker-metrics-section" });
		sankeySection.createEl("h4", { text: "Your application journey" });
		sankeySection.createEl("p", {
			text: "Visual flow of your job hunt based on actual statuses entered/exited, from applications to final outcomes.",
			cls: "text-muted job-tracker-sankey-desc",
		});

		const customization = sankeySection.createEl("details", { cls: "job-tracker-sankey-customize" });
		customization.createEl("summary", { text: "Customize Sankey" });
		const controls = customization.createDiv({ cls: "job-tracker-sankey-controls" });
		const sankeyContent = sankeySection.createDiv({ cls: "job-tracker-sankey-container" });
		this.renderSankeyControls(controls, sankeyContent);
		this.renderSankeyDiagram(sankeyContent);
		sankeySection.createEl("p", {
			text: "Hover or tab to a flow or stage to explore connections. Percentages show the share of all applications.",
			cls: "text-muted job-tracker-sankey-hint",
		});

		// 3. Section: Pipeline Stage Breakdown
		const funnelSection = metricsContainer.createDiv({ cls: "job-tracker-metrics-section is-half" });
		funnelSection.createEl("h4", { text: "Pipeline Stage Breakdown" });

		const funnelBars = funnelSection.createDiv({ cls: "job-tracker-funnel-bars" });

		for (const st of this.view.plugin.settings.statuses) {
			const count = this.view.applications.filter((a) => a.status === st).length;
			if (count === 0) continue;
			const pct = m.totalApps > 0 ? ((count / m.totalApps) * 100).toFixed(1) : "0";

			const barItem = funnelBars.createDiv({ cls: "job-tracker-funnel-item" });

			const labelRow = barItem.createDiv({ cls: "job-tracker-funnel-label-row" });
			const leftLabel = labelRow.createDiv({ cls: "job-tracker-funnel-left" });
			leftLabel.createSpan({ text: st, cls: `job-tracker-status-badge ${getStatusClassName(st)}` });

			const rightLabel = labelRow.createDiv({ cls: "job-tracker-funnel-right" });
			rightLabel.createSpan({
				text: `${count} (${pct}%)`,
				cls: "text-muted",
			});

			const progressBg = barItem.createDiv({ cls: "job-tracker-progress-bg" });
			const progressFill = progressBg.createDiv({
				cls: `job-tracker-progress-fill ${getStatusClassName(st)}`,
			});
			progressFill.setCssStyles({ width: `${pct}%` });
		}

		// 3b. Section: Where rejections happen
		const rejectSection = metricsContainer.createDiv({ cls: "job-tracker-metrics-section is-half" });
		rejectSection.createEl("h4", { text: "Where Rejections Happen" });
		if (m.rejectedCount === 0) {
			rejectSection.createEl("p", { text: "No rejections recorded yet.", cls: "text-muted" });
		} else {
			rejectSection.createEl("p", {
				text: "Last stage reached before each rejection. A pile-up at one stage shows what to practice next.",
				cls: "text-muted job-tracker-sankey-desc",
			});
			const rejectBars = rejectSection.createDiv({ cls: "job-tracker-funnel-bars" });
			const ordered = this.view.plugin.settings.statuses.filter((st) => m.rejectedAtStage.has(st));
			for (const st of m.rejectedAtStage.keys()) {
				if (!ordered.includes(st)) ordered.push(st);
			}
			for (const st of ordered) {
				const count = m.rejectedAtStage.get(st) || 0;
				const share = ((count / m.rejectedCount) * 100).toFixed(1);
				const barItem = rejectBars.createDiv({ cls: "job-tracker-funnel-item" });
				const labelRow = barItem.createDiv({ cls: "job-tracker-funnel-label-row" });
				labelRow.createDiv({ cls: "job-tracker-funnel-left" }).createSpan({
					text: `After ${st}`,
					cls: `job-tracker-status-badge ${getStatusClassName(st)}`,
				});
				labelRow.createDiv({ cls: "job-tracker-funnel-right" }).createSpan({ text: `${count} (${share}%)`, cls: "text-muted" });
				const progressBg = barItem.createDiv({ cls: "job-tracker-progress-bg" });
				progressBg
					.createDiv({ cls: `job-tracker-progress-fill ${getStatusClassName(st)}` })
					.setCssStyles({ width: `${share}%` });
			}
		}

		// 5. Section: Recent Activity Timeline
		const activitySection = metricsContainer.createDiv({ cls: "job-tracker-metrics-section is-half" });
		activitySection.createEl("h4", { text: "Recent Application Activity" });

		if (m.allHistoryEntries.length === 0) {
			activitySection.createEl("p", {
				text: "No recent status activity recorded yet.",
				cls: "text-muted",
			});
		} else {
			const activityList = activitySection.createDiv({ cls: "job-tracker-activity-list" });
			for (const entry of m.allHistoryEntries.slice(0, 8)) {
				const item = activityList.createDiv({ cls: "job-tracker-activity-item" });
				item.createSpan({ cls: `job-tracker-activity-dot ${getStatusClassName(entry.status)}` });

				const textContainer = item.createDiv({ cls: "job-tracker-activity-text" });
				const titleRow = textContainer.createDiv({ cls: "job-tracker-activity-title-row" });
				const compLink = titleRow.createEl("a", {
					text: entry.company,
					cls: "job-tracker-activity-comp-link",
					attr: { role: "link", tabindex: "0" },
				});
				compLink.onclick = () => { void this.view.openNote(entry.filePath); };
				compLink.onkeydown = (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						void this.view.openNote(entry.filePath);
					}
				};

				titleRow.createSpan({ text: `(${entry.role})` });
				titleRow.createSpan({
					text: entry.status,
					cls: `job-tracker-status-badge ${getStatusClassName(entry.status)}`,
				});
				titleRow.createSpan({ text: entry.date, cls: "job-tracker-activity-date" });

				if (entry.note) {
					textContainer.createDiv({ text: entry.note, cls: "job-tracker-activity-note" });
				}
			}
		}
	}

	renderKpiCard(container: HTMLElement, label: string, value: string, icon: string, subtext: string) {
		const card = container.createDiv({
			cls: "job-tracker-kpi-card",
			attr: {
				role: "region",
				"aria-label": `${label}: ${value} (${subtext})`,
			},
		});
		const top = card.createDiv({ cls: "job-tracker-kpi-top" });
		top.createSpan({ text: label, cls: "job-tracker-kpi-label" });
		const iconEl = top.createSpan({ cls: "job-tracker-kpi-icon" });
		setIcon(iconEl, icon);

		card.createDiv({ text: value, cls: "job-tracker-kpi-value" });
		card.createDiv({ text: subtext, cls: "job-tracker-kpi-subtext" });
	}

	private renderSankeyControls(controls: HTMLElement, chart: HTMLElement): void {
		controls.empty();
		const options = this.view.plugin.settings.sankey;
		const update = (patch: Partial<SankeySettings>) => {
			this.view.plugin.settings.sankey = { ...this.view.plugin.settings.sankey, ...patch };
			this.renderSankeyDiagram(chart);
			// Keep the controls mounted so keyboard focus and slider interaction survive.
			void this.view.plugin.saveSettings(false).catch((error: unknown) => {
				console.error("Job Tracker: Could not save Sankey preferences", error);
				new Notice("Could not save chart preferences. Please try again.");
			});
		};
		new Setting(controls).setName("Color palette").addDropdown(d => d
			.addOptions({ aurora: "Aurora · violet & mint", sunset: "Sunset · coral & gold", ocean: "Ocean · blue & teal", classic: "Classic · status colors" })
			.setValue(options.palette).onChange(value => update({ palette: value as SankeySettings["palette"] })));
		new Setting(controls).setName("Flow colors").addDropdown(d => d
			.addOptions({ gradient: "Blend between stages", source: "Match starting stage", target: "Match destination" })
			.setValue(options.flowStyle).onChange(value => update({ flowStyle: value as SankeySettings["flowStyle"] })));
		new Setting(controls).setName("Spacing").addDropdown(d => d
			.addOptions({ compact: "Compact", comfortable: "Comfortable", airy: "Airy" })
			.setValue(options.spacing).onChange(value => update({ spacing: value as SankeySettings["spacing"] })));
		new Setting(controls).setName("Labels").addDropdown(d => d
			.addOptions({ counts: "Names & counts", percentages: "Names & percentages", names: "Names only" })
			.setValue(options.labels).onChange(value => update({ labels: value as SankeySettings["labels"] })));
		new Setting(controls).setName("Flow opacity").addSlider(s => s
			.setLimits(15, 90, 5).setValue(options.opacity).setDynamicTooltip()
			.onChange(value => update({ opacity: value })));
		new Setting(controls).setName("Dotted background").addToggle(t => t
			.setValue(options.showGrid).onChange(value => update({ showGrid: value })));
		new Setting(controls).setName("Restore chart defaults").addButton(b => b
			.setButtonText("Reset style").onClick(() => {
				update({ ...DEFAULT_SANKEY_SETTINGS });
				this.renderSankeyControls(controls, chart);
			}));
	}

	renderSankeyDiagram(container: HTMLElement) {
		container.empty();

		if (this.view.applications.length === 0) {
			container.createEl("p", {
				text: "No application data available yet. Add applications to see your Sankey flow diagram.",
				cls: "text-muted",
			});
			return;
		}

		// Count transitions between nodes ensuring strict DAG property (no cycles)
		const transitionMap = new Map<string, number>();
		const adjList = new Map<string, Set<string>>();

		// Helper to detect if adding fromNode -> toNode creates a cycle (i.e. toNode can already reach fromNode)
		const wouldCreateCycle = (fromNode: string, toNode: string): boolean => {
			const visited = new Set<string>();
			const queue = [toNode];
			while (queue.length > 0) {
				const current = queue.shift()!;
				if (current === fromNode) return true;
				visited.add(current);
				const neighbors = adjList.get(current);
				if (neighbors) {
					for (const v of neighbors) {
						if (!visited.has(v)) {
							queue.push(v);
						}
					}
				}
			}
			return false;
		};

		const addTransition = (fromNode: string, toNode: string, count = 1) => {
			if (fromNode === toNode || count <= 0) return;
			const cleanFrom = fromNode.replace(/[,;"\n\r]+/g, " ").trim();
			const cleanTo = toNode.replace(/[,;"\n\r]+/g, " ").trim();
			if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return;

			const key = `${cleanFrom}|||${cleanTo}`;
			if (transitionMap.has(key)) {
				transitionMap.set(key, transitionMap.get(key)! + count);
				return;
			}

			// If this new link would create a global cycle, reject it to avoid circular link crashes
			if (wouldCreateCycle(cleanFrom, cleanTo)) {
				return;
			}

			transitionMap.set(key, count);
			let targets = adjList.get(cleanFrom);
			if (!targets) {
				targets = new Set<string>();
				adjList.set(cleanFrom, targets);
			}
			targets.add(cleanTo);
		};

		// Track each application along the exact sequence of statuses it entered and exited
		for (const app of this.view.applications) {
			const source = "All applications";
			const visited = this.view.getVisitedStatuses(app);

			if (visited.length === 0) continue;

			// A single entry point includes applications that have not changed stages yet.
			const firstStage = visited[0];
			addTransition(source, firstStage, 1);

			// Connect all sequential stage transitions
			for (let i = 0; i < visited.length - 1; i++) {
				const fromStage = visited[i];
				const toStage = visited[i + 1];
				addTransition(fromStage, toStage, 1);
			}
		}

		if (transitionMap.size === 0) {
			container.createEl("p", {
				text: "Not enough flow transitions to render diagram.",
				cls: "text-muted",
			});
			return;
		}

		const sankeyLinks: SankeyLink[] = [];
		for (const [key, count] of transitionMap.entries()) {
			const [from, to] = key.split("|||");
			sankeyLinks.push({
				source: from,
				target: to,
				value: count,
			});
		}

		SankeyDiagram.render(container, sankeyLinks, this.view.applications.length, this.view.plugin.settings.sankey);
	}
}
