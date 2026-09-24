import { App, ButtonComponent, Setting, TFile } from "obsidian";
import JobApplicationTrackerPlugin from "../main";
import { JobApplication, JobStatus } from "../types";
import { addDays, formatLongDate, isEnteringOA, normalizeTime } from "../oaDeadline";
import { BaseApplicationModal } from "./BaseApplicationModal";

type DeadlineMode = "relative" | "date";

interface Deadline {
	date: string; // YYYY-MM-DD, "" when invalid
	time?: string; // HH:mm
}

const DEFAULT_OA_DAYS = 7;

/**
 * Asks for an online assessment deadline, either as a fixed date or as
 * "N days after the OA email was received" (how most OA invites phrase it).
 *
 * With `targetStatus` set, submitting moves the application to that status and stores the
 * deadline. Without it, the modal just edits the deadline of an application already in OA.
 */
export class OADeadlineModal extends BaseApplicationModal {
	private targetStatus: JobStatus | null;
	private note: string | undefined;
	private mode: DeadlineMode = "relative";
	private emailDate: string;
	private emailTime = "";
	private days = DEFAULT_OA_DAYS;
	private fixedDate: string;
	private fixedTime: string;

	constructor(
		app: App,
		plugin: JobApplicationTrackerPlugin,
		application: JobApplication,
		targetStatus: JobStatus | null = null,
		note?: string
	) {
		super(app, plugin, application);
		this.targetStatus = targetStatus;
		this.note = note;
		const today = plugin.appService.getTodayDateString();
		this.emailDate = today;
		this.fixedDate = application.oaDeadline || addDays(today, DEFAULT_OA_DAYS);
		this.fixedTime = application.oaDeadlineTime || "";
		if (application.oaDeadline) this.mode = "date";
	}

	/** In relative mode the deadline keeps the email's time of day ("expires 72 hours after receipt"). */
	private computeDeadline(): Deadline {
		if (this.mode === "date") return { date: this.fixedDate, time: normalizeTime(this.fixedTime) || undefined };
		if (!this.emailDate || !Number.isFinite(this.days) || this.days < 0) return { date: "" };
		return { date: addDays(this.emailDate, this.days), time: normalizeTime(this.emailTime) || undefined };
	}

	/** A date input with an optional time input beside it. */
	private addDateTimeSetting(
		name: string,
		desc: string,
		date: string,
		time: string,
		onDate: (value: string) => void,
		onTime: (value: string) => void
	): void {
		new Setting(this.contentEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(date).onChange(onDate);
			})
			.addText((text) => {
				text.inputEl.type = "time";
				text.inputEl.addClass("job-tracker-oa-time-input");
				text.inputEl.setAttribute("aria-label", `${name} time (optional)`);
				text.setValue(time).onChange(onTime);
			});
	}

	renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		if (!this.application) return;

		contentEl.createEl("h2", { text: `OA Deadline: ${this.application.company}` });
		contentEl.createEl("p", {
			text: this.targetStatus
				? `${this.application.role}. Moving to "${this.targetStatus}". When is the online assessment due?`
				: `${this.application.role}. When is the online assessment due?`,
			cls: "job-tracker-modal-subtitle",
		});

		new Setting(contentEl)
			.setName("Deadline type")
			.addDropdown((dropdown) => {
				dropdown.addOption("relative", "Expires N days after the email");
				dropdown.addOption("date", "Specific date");
				dropdown.setValue(this.mode);
				dropdown.onChange((value) => {
					this.mode = value as DeadlineMode;
					this.renderContent();
				});
			});

		let previewEl: HTMLElement;
		const updatePreview = () => {
			const deadline = this.computeDeadline();
			previewEl.setText(deadline.date ? `Due ${formatLongDate(deadline.date, deadline.time)}` : "Enter a valid date");
			previewEl.toggleClass("is-invalid", !deadline.date);
		};

		if (this.mode === "relative") {
			this.addDateTimeSetting(
				"Email received",
				"The day the OA invite arrived. Time is optional; the deadline keeps the same time of day.",
				this.emailDate,
				this.emailTime,
				(value) => {
					this.emailDate = value;
					updatePreview();
				},
				(value) => {
					this.emailTime = value;
					updatePreview();
				}
			);
			new Setting(contentEl)
				.setName("Expires after (days)")
				.setDesc('e.g. "The assessment expires 7 days from receipt of this email"')
				.addText((text) => {
					text.inputEl.type = "number";
					text.inputEl.min = "0";
					text.inputEl.max = "365";
					text.setValue(String(this.days)).onChange((value) => {
						this.days = parseInt(value, 10);
						updatePreview();
					});
				});
		} else {
			this.addDateTimeSetting(
				"Due date",
				"Time is optional",
				this.fixedDate,
				this.fixedTime,
				(value) => {
					this.fixedDate = value;
					updatePreview();
				},
				(value) => {
					this.fixedTime = value;
					updatePreview();
				}
			);
		}

		previewEl = contentEl.createDiv({ cls: "job-tracker-oa-deadline-preview" });
		updatePreview();

		let saveBtn: ButtonComponent;
		const buttons = new Setting(contentEl).addButton((btn) => {
			saveBtn = btn;
			btn
				.setButtonText(this.targetStatus ? `Move to ${this.targetStatus}` : "Save Deadline")
				.setCta()
				.onClick(async () => {
					const deadline = this.computeDeadline();
					if (!deadline.date) return;
					saveBtn.setDisabled(true);
					await this.submit(deadline, saveBtn);
				});
		});
		if (this.targetStatus || this.application.oaDeadline) {
			buttons.addButton((btn) =>
				btn
					.setButtonText(this.targetStatus ? "No Deadline" : "Clear Deadline")
					.onClick(async () => {
						btn.setDisabled(true);
						await this.submit({ date: "" }, btn);
					})
			);
		}
		buttons.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	/** An empty deadline date moves without one (or clears the existing one when editing). */
	private async submit(deadline: Deadline, btn: ButtonComponent): Promise<void> {
		try {
			const file = this.resolveApplicationFile();
			if (!(file instanceof TFile)) {
				btn.setDisabled(false);
				return;
			}
			if (this.targetStatus) {
				await this.plugin.appService.updateStatus(file, this.targetStatus, this.note, deadline.date ? deadline : undefined);
			} else {
				await this.plugin.appService.updateApplicationFields(file, {
					oaDeadline: deadline.date,
					oaDeadlineTime: deadline.date ? deadline.time || "" : "",
				});
			}
			this.isCompleted = true;
			this.close();
		} catch (err) {
			btn.setDisabled(false);
			this.handleModalError("Set OA deadline", err);
		}
	}
}

/**
 * Moves an application to `newStatus`, first asking for an OA deadline when it is entering an
 * OA stage. Cancelling the deadline prompt leaves the application where it was.
 */
export async function moveApplicationToStatus(
	app: App,
	plugin: JobApplicationTrackerPlugin,
	application: JobApplication,
	file: TFile,
	newStatus: JobStatus,
	note?: string
): Promise<void> {
	if (isEnteringOA(application, newStatus)) {
		new OADeadlineModal(app, plugin, application, newStatus, note).open();
		return;
	}
	await plugin.appService.updateStatus(file, newStatus, note);
}
