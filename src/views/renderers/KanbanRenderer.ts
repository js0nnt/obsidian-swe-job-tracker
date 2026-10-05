import { setIcon, TFile } from "obsidian";
import { JobApplication } from "../../types";
import { getStatusClassName } from "../../constants";
import { getStageCategory, reachedInterview } from "../../stages";
import { compareByOADeadline, describeDeadline, formatLocalDate, formatLongDate, formatTime, normalizeTime } from "../../oaDeadline";
import { NewApplicationModal } from "../../modals/NewApplicationModal";
import { moveApplicationToStatus, OADeadlineModal } from "../../modals/OADeadlineModal";
import { UpdateStatusModal } from "../../modals/UpdateStatusModal";
import { JobTrackerView } from "../JobTrackerView";

/**
 * Renderer for the Kanban view mode, handling column stages, drag-and-drop, and card interactions.
 */
const KANBAN_DRAG_MIME = "application/x-job-tracker-filepath";

export class KanbanRenderer {
	view: JobTrackerView;
	focusedCardPath: string | null = null;

	constructor(view: JobTrackerView) {
		this.view = view;
	}

	/**
	 * Renders the Kanban board with drag-and-drop columns for each status.
	 */
	render(container: HTMLElement, apps: JobApplication[]) {
		this.renderOADeadlineTracker(container, apps);

		const board = container.createDiv({ cls: "job-tracker-kanban-board" });
		const statuses = this.view.plugin.settings.statuses;
		// Statuses split evenly across two rows (first half on top) so the board never scrolls sideways.
		board.style.setProperty("--kanban-columns", String(Math.max(1, Math.ceil(statuses.length / 2))));

		for (const status of statuses) {
			const colApps = apps.filter((a) => a.status === status);
			// OA columns list the most urgent assessment first
			if (getStageCategory(status) === "oa") colApps.sort(compareByOADeadline);

			const column = board.createDiv({
				cls: `job-tracker-kanban-column ${getStatusClassName(status)}`,
				attr: { role: "region", "aria-label": `${status} column, ${colApps.length} applications` },
			});

			// Drag and drop event handlers on column with counter to eliminate child element flicker
			let dragEnterCount = 0;
			column.ondragenter = (e) => {
				if (e.dataTransfer?.types.includes(KANBAN_DRAG_MIME)) {
					dragEnterCount++;
					column.addClass("drag-over");
				}
			};
			column.ondragover = (e) => {
				e.preventDefault();
			};
			column.ondragleave = () => {
				dragEnterCount = Math.max(0, dragEnterCount - 1);
				if (dragEnterCount === 0) {
					column.removeClass("drag-over");
				}
			};
			column.ondrop = async (e) => {
				e.preventDefault();
				dragEnterCount = 0;
				column.removeClass("drag-over");
				const filePath = e.dataTransfer?.getData(KANBAN_DRAG_MIME);
				if (filePath) {
					const app = this.view.applications.find((a) => a.filePath === filePath);
					if (app && app.status === status) {
						return;
					}
					const file = this.view.plugin.appService.resolveFile(filePath);
					if (file instanceof TFile) {
						if (app) {
							await moveApplicationToStatus(this.view.app, this.view.plugin, app, file, status);
						} else {
							await this.view.plugin.appService.updateStatus(file, status);
						}
					}
				}
			};

			// Column Header
			const colHeader = column.createDiv({ cls: "job-tracker-kanban-col-header" });
			const colTitle = colHeader.createDiv({ cls: "job-tracker-kanban-col-title" });
			colTitle.createSpan({ text: status, cls: "job-tracker-status-pill" });
			colTitle.createSpan({ text: `${colApps.length}`, cls: "job-tracker-col-count" });

			const colAddBtn = colHeader.createEl("button", {
				cls: "job-tracker-col-add-btn",
				attr: { "aria-label": `Add application in ${status}` },
			});
			setIcon(colAddBtn, "plus");
			colAddBtn.onclick = () => {
				const modal = new NewApplicationModal(this.view.app, this.view.plugin);
				modal.open();
			};

			// Column Card Container
			const cardList = column.createDiv({ cls: "job-tracker-kanban-cards" });

			if (colApps.length === 0) {
				const emptyMsg = cardList.createDiv({ cls: "job-tracker-kanban-empty" });
				emptyMsg.createSpan({ text: "Drop here" });
			} else {
				for (const app of colApps) {
					this.renderCard(cardList, app);
				}
			}
		}

		if (this.focusedCardPath) {
			const targetCard = board.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(this.focusedCardPath)}"]`);
			if (targetCard) {
				targetCard.focus();
			}
			this.focusedCardPath = null;
		}
	}

	renderCard(container: HTMLElement, app: JobApplication) {
		const card = container.createDiv({
			cls: "job-tracker-kanban-card",
			attr: {
				draggable: "true",
				role: "article",
				tabindex: "0",
				"data-file-path": app.filePath,
				"aria-label": `${app.company} - ${app.role} (${app.status}). Press Alt+Right or Alt+Left arrow to change stage.`,
			},
		});

		// Keyboard navigation between Kanban columns
		card.onkeydown = async (e) => {
			if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
				e.preventDefault();
				const statuses = this.view.plugin.settings.statuses;
				const currentIndex = statuses.indexOf(app.status);
				if (currentIndex === -1) return;
				const targetIndex = e.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
				if (targetIndex >= 0 && targetIndex < statuses.length) {
					const nextStatus = statuses[targetIndex];
					const file = this.view.plugin.appService.resolveFile(app.filePath);
					if (file instanceof TFile) {
						this.focusedCardPath = app.filePath;
						await moveApplicationToStatus(this.view.app, this.view.plugin, app, file, nextStatus);
					}
				}
			}
		};

		// Drag events
		card.ondragstart = (e) => {
			e.dataTransfer?.setData(KANBAN_DRAG_MIME, app.filePath);
			card.addClass("is-dragging");
		};
		card.ondragend = () => {
			card.removeClass("is-dragging");
		};

		// Card top: Company & Actions menu
		const cardTop = card.createDiv({ cls: "job-tracker-card-top" });
		const companyLink = cardTop.createEl("a", {
			text: app.company,
			cls: "job-tracker-card-company",
			attr: { tabindex: "0", role: "link" },
		});
		companyLink.onclick = (e) => {
			e.preventDefault();
			void this.view.openNote(app.filePath);
		};
		companyLink.onkeydown = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this.view.openNote(app.filePath);
			}
		};

		const actionsGroup = cardTop.createDiv({ cls: "job-tracker-card-actions-group" });
		const statusPill = actionsGroup.createSpan({
			text: app.status,
			cls: `job-tracker-status-badge ${getStatusClassName(app.status)}`,
			attr: { "aria-label": `Change status (Current: ${app.status})`, role: "button", tabindex: "0" },
		});
		statusPill.onclick = (e) => {
			e.stopPropagation();
			new UpdateStatusModal(this.view.app, this.view.plugin, app).open();
		};
		statusPill.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				new UpdateStatusModal(this.view.app, this.view.plugin, app).open();
			}
		};

		const menuBtn = actionsGroup.createSpan({
			cls: "job-tracker-card-menu-btn",
			attr: { role: "button", tabindex: "0", "aria-label": "Application actions" },
		});
		setIcon(menuBtn, "more-vertical");
		menuBtn.onclick = (e) => {
			e.stopPropagation();
			this.view.showCardMenu(e, app);
		};
		menuBtn.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				this.view.showCardMenu(e, app);
			}
		};

		// Role title
		const roleEl = card.createDiv({
			cls: "job-tracker-card-role",
			text: app.role,
			attr: { tabindex: "0", role: "button", "aria-label": `Open note: ${app.role}` },
		});
		roleEl.onclick = () => { void this.view.openNote(app.filePath); };
		roleEl.onkeydown = (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this.view.openNote(app.filePath);
			}
		};

		// Tags & Badges
		const badgesRow = card.createDiv({ cls: "job-tracker-card-badges" });
		if (getStageCategory(app.status) === "oa") {
			this.renderOADeadlineBadge(badgesRow, app);
		}
		if (app.location) {
			const locBadge = badgesRow.createSpan({ cls: "job-tracker-badge" });
			const locIcon = locBadge.createSpan({ cls: "job-tracker-badge-icon" });
			setIcon(locIcon, "map-pin");
			locBadge.createSpan({ text: app.location });
		}
		if (app.salary) {
			const salBadge = badgesRow.createSpan({ cls: "job-tracker-badge job-tracker-badge-salary" });
			salBadge.createSpan({ text: app.salary });
		}
		if (app.jobDescriptionFile) {
			const isPdf = app.jobDescriptionFile.toLowerCase().endsWith(".pdf");
			const jdBadge = badgesRow.createSpan({
				cls: "job-tracker-badge job-tracker-badge-attachment",
				attr: { "aria-label": `Open attached JD: ${app.jobDescriptionFile}`, role: "button", tabindex: "0" },
			});
			const jdIcon = jdBadge.createSpan({ cls: "job-tracker-badge-icon" });
			setIcon(jdIcon, isPdf ? "file-text" : "file");
			jdBadge.createSpan({ text: isPdf ? "PDF JD" : "MD JD" });
			jdBadge.onclick = (e) => {
				e.stopPropagation();
				void this.view.openNote(app.jobDescriptionFile!);
			};
			jdBadge.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					e.stopPropagation();
					void this.view.openNote(app.jobDescriptionFile!);
				}
			};
		}

		// Contacts & Interviews meta
		const metaRow = card.createDiv({ cls: "job-tracker-card-meta" });

		if (app.contacts && app.contacts.length > 0) {
			const contactMeta = metaRow.createSpan({
				cls: "job-tracker-meta-item",
				attr: { "aria-label": `${app.contacts.length} Contact(s)` },
			});
			const cIcon = contactMeta.createSpan();
			setIcon(cIcon, "user");
			contactMeta.createSpan({ text: `${app.contacts.length}` });
		}

		if (app.interviews && app.interviews.length > 0) {
			const ivMeta = metaRow.createSpan({
				cls: "job-tracker-meta-item",
				attr: { "aria-label": `${app.interviews.length} Interview(s)` },
			});
			const ivIcon = ivMeta.createSpan();
			setIcon(ivIcon, "calendar");
			ivMeta.createSpan({ text: `${app.interviews.length}` });
		}

		metaRow.createSpan({
			cls: "job-tracker-meta-item job-tracker-date-meta",
			text: app.dateApplied || app.lastUpdated || "",
		});
	}

	/**
	 * List above the board of every application currently in an OA stage, closest deadline first.
	 */
	private renderOADeadlineTracker(container: HTMLElement, apps: JobApplication[]) {
		const oaApps = apps.filter((a) => getStageCategory(a.status) === "oa").sort(compareByOADeadline);

		const tracker = container.createDiv({
			cls: "job-tracker-oa-tracker",
			attr: { role: "region", "aria-label": `OA deadlines, ${oaApps.length} assessments` },
		});
		const header = tracker.createDiv({ cls: "job-tracker-oa-tracker-header" });
		const headerIcon = header.createSpan({ cls: "job-tracker-oa-tracker-icon" });
		setIcon(headerIcon, "timer");
		header.createEl("h4", { text: "OA Deadlines" });
		header.createSpan({ text: `${oaApps.length}`, cls: "job-tracker-col-count" });

		if (oaApps.length === 0) {
			tracker.createDiv({
				cls: "job-tracker-oa-tracker-empty",
				text: "No online assessments pending. Drag an application into OA to track its deadline.",
			});
			return;
		}

		const body = tracker.createDiv({ cls: "job-tracker-oa-tracker-body" });
		const list = body.createDiv({ cls: "job-tracker-oa-tracker-list" });
		const aside = body.createDiv({ cls: "job-tracker-oa-aside" });
		this.renderOAStatistics(aside, oaApps.length);
		this.renderOACalendar(aside, oaApps, tracker);
		for (const app of oaApps) {
			const row = list.createDiv({ cls: "job-tracker-oa-tracker-row" });
			this.renderOADeadlineBadge(row, app);

			const info = row.createDiv({ cls: "job-tracker-oa-tracker-info" });
			const companyLink = info.createEl("a", {
				text: app.company,
				cls: "job-tracker-card-company",
				attr: { tabindex: "0", role: "link" },
			});
			companyLink.onclick = (e) => {
				e.preventDefault();
				void this.view.openNote(app.filePath);
			};
			companyLink.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void this.view.openNote(app.filePath);
				}
			};
			info.createSpan({ text: app.role, cls: "job-tracker-oa-tracker-role" });
			if (app.oaLink) {
				const link = info.createEl("a", {
					text: "Open assessment",
					cls: "job-tracker-oa-tracker-link",
					href: app.oaLink,
					attr: { title: app.oaLink, target: "_blank", rel: "noopener noreferrer" },
				});
				link.onclick = (e) => e.stopPropagation();
			}

			row.createSpan({
				text: app.oaDeadline ? formatLongDate(app.oaDeadline, app.oaDeadlineTime) : "No deadline",
				cls: "job-tracker-oa-tracker-date",
			});

			const menuBtn = row.createSpan({
				cls: "job-tracker-card-menu-btn",
				attr: { role: "button", tabindex: "0", "aria-label": "Application actions" },
			});
			setIcon(menuBtn, "more-vertical");
			menuBtn.onclick = (e) => {
				e.stopPropagation();
				this.view.showCardMenu(e, app);
			};
			menuBtn.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.view.showCardMenu(e, app);
				}
			};
		}
	}

	/** Online assessment statistics across every application, not just the ones currently in OA. */
	private renderOAStatistics(container: HTMLElement, pendingCount: number) {
		const box = container.createDiv({ cls: "job-tracker-oa-summary", attr: { role: "group", "aria-label": "OA statistics" } });
		const apps = this.view.applications;
		let received = 0;
		let advanced = 0;
		let rejectedAtOA = 0;
		const waits: number[] = [];
		for (const app of apps) {
			const path = this.view.getVisitedStatuses(app);
			const oaIndex = path.findIndex((st) => getStageCategory(st) === "oa");
			if (oaIndex === -1) continue;
			received++;
			const after = path.slice(oaIndex + 1);
			if (after.some(reachedInterview)) advanced++;
			else if (after.length > 0 && getStageCategory(after[0]) === "rejected") rejectedAtOA++;
			const entry = (app.statusHistory || []).find((h) => getStageCategory(h.status) === "oa");
			const days = entry && app.dateApplied ? (Date.parse(entry.date) - Date.parse(app.dateApplied)) / 86400000 : NaN;
			if (Number.isFinite(days) && days >= 0) waits.push(days);
		}
		const percent = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "–");
		const average = waits.length ? `${Math.round(waits.reduce((sum, d) => sum + d, 0) / waits.length)} days` : "–";

		box.createEl("h5", { text: "OA statistics" });
		const rows: [string, string][] = [
			["OAs received", `${received} (${percent(received, apps.length)} of applications)`],
			["Waiting to take", String(pendingCount)],
			["Moved to interviews", `${advanced} (${percent(advanced, received)})`],
			["Rejected after OA", `${rejectedAtOA} (${percent(rejectedAtOA, received)})`],
			["Avg. days to receive OA", average],
		];
		for (const [label, value] of rows) {
			const row = box.createDiv({ cls: "job-tracker-oa-summary-row" });
			row.createSpan({ text: label });
			row.createSpan({ text: value, cls: "job-tracker-oa-summary-count" });
		}
	}

	/** Month grid beside the OA list; days with a deadline get a dot colored by urgency. */
	private renderOACalendar(container: HTMLElement, oaApps: JobApplication[], tracker: HTMLElement) {
		const byDay = new Map<string, JobApplication[]>();
		for (const app of oaApps) {
			if (!app.oaDeadline) continue;
			const day = app.oaDeadline.slice(0, 10);
			byDay.set(day, [...(byDay.get(day) || []), app]);
		}

		const calendar = container.createDiv({ cls: "job-tracker-oa-cal", attr: { role: "group", "aria-label": "OA deadline calendar" } });
		const popover = tracker.createDiv({ cls: "job-tracker-oa-popover", attr: { role: "tooltip" } });
		const hidePopover = () => popover.removeClass("is-visible");
		const showPopover = (cell: HTMLElement, due: JobApplication[]) => {
			popover.empty();
			for (const app of due) {
				const entry = popover.createDiv({ cls: "job-tracker-oa-popover-entry" });
				entry.createEl("strong", { text: app.company });
				entry.createDiv({ text: app.role, cls: "job-tracker-oa-popover-role" });
				entry.createDiv({ text: `${formatLongDate(app.oaDeadline!, app.oaDeadlineTime)} · ${describeDeadline(app.oaDeadline!, app.oaDeadlineTime).label}` });
				if (app.oaLink) entry.createDiv({ text: "Assessment link saved", cls: "job-tracker-oa-popover-role" });
			}
			popover.addClass("is-visible");
			const box = tracker.getBoundingClientRect();
			const rect = cell.getBoundingClientRect();
			const left = Math.max(8, Math.min(rect.right - box.left - popover.offsetWidth, box.width - popover.offsetWidth - 8));
			popover.style.left = `${left}px`;
			popover.style.top = `${rect.bottom - box.top + 6}px`;
		};
		const now = new Date();
		const todayKey = formatLocalDate(now);
		// Open on the month of the nearest upcoming deadline so there is something to see.
		const upcoming = [...byDay.keys()].sort().find((day) => day >= todayKey) || [...byDay.keys()].sort()[0];
		const start = upcoming ? new Date(Number(upcoming.slice(0, 4)), Number(upcoming.slice(5, 7)) - 1, 1) : new Date(now.getFullYear(), now.getMonth(), 1);
		let year = start.getFullYear();
		let month = start.getMonth();

		const draw = () => {
			calendar.empty();
			const header = calendar.createDiv({ cls: "job-tracker-oa-cal-header" });
			const step = (delta: number, label: string, icon: string) => {
				const btn = header.createEl("button", { cls: "job-tracker-oa-cal-nav", attr: { type: "button", "aria-label": label } });
				setIcon(btn, icon);
				btn.onclick = () => {
					const moved = new Date(year, month + delta, 1);
					year = moved.getFullYear();
					month = moved.getMonth();
					draw();
				};
				return btn;
			};
			step(-1, "Previous month", "chevron-left");
			header.createSpan({ text: new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }), cls: "job-tracker-oa-cal-title" });
			step(1, "Next month", "chevron-right");

			const grid = calendar.createDiv({ cls: "job-tracker-oa-cal-grid" });
			for (const letter of ["S", "M", "T", "W", "T", "F", "S"]) grid.createSpan({ text: letter, cls: "job-tracker-oa-cal-weekday" });
			for (let i = 0; i < new Date(year, month, 1).getDay(); i++) grid.createSpan();

			for (let day = 1; day <= new Date(year, month + 1, 0).getDate(); day++) {
				const key = formatLocalDate(new Date(year, month, day));
				const due = byDay.get(key) || [];
				const cell = grid.createSpan({ text: String(day), cls: "job-tracker-oa-cal-day" });
				if (key === todayKey) cell.addClass("is-today");
				if (due.length === 0) continue;
				const first = due[0];
				cell.addClass("has-oa", `is-${describeDeadline(first.oaDeadline!, first.oaDeadlineTime).urgency}`);
				const summary = due.map((a) => `${a.company}${normalizeTime(a.oaDeadlineTime) ? ` at ${formatTime(a.oaDeadlineTime!)}` : ""}`).join(", ");
				cell.setAttribute("tabindex", "0");
				cell.setAttribute("aria-label", `${key}: OA due for ${summary}`);
				cell.addEventListener("mouseenter", () => showPopover(cell, due));
				cell.addEventListener("focus", () => showPopover(cell, due));
				cell.addEventListener("mouseleave", hidePopover);
				cell.addEventListener("blur", hidePopover);
			}
		};
		draw();
	}

	/** Countdown badge for an OA application; clicking it edits the deadline. */
	private renderOADeadlineBadge(container: HTMLElement, app: JobApplication) {
		const { label, urgency } = app.oaDeadline
			? describeDeadline(app.oaDeadline, app.oaDeadlineTime)
			: { label: "Set OA deadline", urgency: "none" };
		const badge = container.createSpan({
			cls: `job-tracker-badge job-tracker-badge-oa-deadline is-${urgency}`,
			attr: {
				role: "button",
				tabindex: "0",
				"aria-label": app.oaDeadline ? `OA due ${formatLongDate(app.oaDeadline, app.oaDeadlineTime)}. Click to change.` : "Set OA deadline",
				title: app.oaDeadline ? `OA due ${formatLongDate(app.oaDeadline, app.oaDeadlineTime)}` : "",
			},
		});
		const icon = badge.createSpan({ cls: "job-tracker-badge-icon" });
		setIcon(icon, urgency === "overdue" ? "alert-triangle" : "timer");
		badge.createSpan({ text: label });

		const edit = () => new OADeadlineModal(this.view.app, this.view.plugin, app).open();
		badge.onclick = (e) => {
			e.stopPropagation();
			edit();
		};
		badge.onkeydown = (e) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				e.stopPropagation();
				edit();
			}
		};
	}
}
