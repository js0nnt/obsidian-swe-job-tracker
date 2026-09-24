import { App, ButtonComponent, Setting, TFile } from "obsidian";
import JobApplicationTrackerPlugin from "../main";
import { JobApplication, JobStatus } from "../types";
import { addDays, formatLongDate, isEnteringOA } from "../oaDeadline";
import { BaseApplicationModal } from "./BaseApplicationModal";

type DeadlineMode = "relative" | "date";

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
	private days = DEFAULT_OA_DAYS;
	private fixedDate: string;

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
		if (application.oaDeadline) this.mode = "date";
	}

	private computeDeadline(): string {
		if (this.mode === "date") return this.fixedDate;
		if (!this.emailDate || !Number.isFinite(this.days) || this.days < 0) return "";
		return addDays(this.emailDate, this.days);
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
			previewEl.setText(deadline ? `Due ${formatLongDate(deadline)}` : "Enter a valid date");
			previewEl.toggleClass("is-invalid", !deadline);
		};

		if (this.mode === "relative") {
			new Setting(contentEl)
				.setName("Email received")
				.setDesc("The day the OA invite arrived")
				.addText((text) => {
					text.inputEl.type = "date";
					text.setValue(this.emailDate).onChange((value) => {
						this.emailDate = value;
						updatePreview();
					});
				});
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
			new Setting(contentEl)
				.setName("Due date")
				.addText((text) => {
					text.inputEl.type = "date";
					text.setValue(this.fixedDate).onChange((value) => {
						this.fixedDate = value;
						updatePreview();
					});
				});
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
					if (!deadline) return;
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
						await this.submit("", btn);
					})
			);
		}
		buttons.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()));
	}

	/** An empty `deadline` moves without one (or clears the existing one when editing). */
	private async submit(deadline: string, btn: ButtonComponent): Promise<void> {
		try {
			const file = this.resolveApplicationFile();
			if (!(file instanceof TFile)) {
				btn.setDisabled(false);
				return;
			}
			if (this.targetStatus) {
				await this.plugin.appService.updateStatus(file, this.targetStatus, this.note, deadline || undefined);
			} else {
				await this.plugin.appService.updateApplicationFields(file, { oaDeadline: deadline });
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
