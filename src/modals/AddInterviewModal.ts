import { App, ButtonComponent, Notice, Setting } from "obsidian";
import JobApplicationTrackerPlugin from "../main";
import { InterviewRound, InterviewRoundType, JobApplication } from "../types";
import { BaseApplicationModal } from "./BaseApplicationModal";
import { getAutoAdvanceStatus } from "../stages";

export const INTERVIEW_TYPES: InterviewRoundType[] = [
	"Online Assessment (OA)",
	"Take-Home Project",
	"Recruiter Screen",
	"Technical Phone Screen",
	"Coding / DSA",
	"System Design",
	"Behavioral",
	"Hiring Manager",
	"Final Round / Superday",
	"Team Match",
	"Other",
];

/**
 * Modal dialog to schedule a new interview round and optionally generate prep notes.
 */
export class AddInterviewModal extends BaseApplicationModal {
	private roundType: InterviewRoundType = "Online Assessment (OA)";
	private roundName = "Online Assessment (OA)";
	private date = "";
	private time = "";
	private interviewers = "";
	private createPrepNote = true;
	private autoAdvanceStatus = true;

	constructor(
		app: App,
		plugin: JobApplicationTrackerPlugin,
		application: JobApplication | null = null,
		onComplete?: () => void,
		onCancel?: () => void
	) {
		super(app, plugin, application, onComplete, onCancel);
		this.date = plugin.appService.getTodayDateString();
	}

	renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (!this.application) return;

		contentEl.createEl("h2", { text: `Add Interview: ${this.application.company}` });
		contentEl.createEl("p", {
			text: `${this.application.role}`,
			cls: "job-tracker-modal-subtitle",
		});

		// Round Type
		new Setting(contentEl)
			.setName("Interview Type / Stage")
			.setDesc("Select standard interview type")
			.addDropdown((dropdown) => {
				for (const type of INTERVIEW_TYPES) {
					dropdown.addOption(type, type);
				}
				dropdown.setValue(this.roundType);
				dropdown.onChange((value) => {
					this.roundType = value as InterviewRoundType;
					if (this.roundName === "" || INTERVIEW_TYPES.includes(this.roundName as InterviewRoundType)) {
						this.roundName = value;
					}
					this.renderContent();
				});
			});

		// Round Custom Name
		new Setting(contentEl)
			.setName("Round Display Name")
			.setDesc("Custom name for this stage (e.g. 'Round 1 - Coding', 'HackerRank OA')")
			.addText((text) => {
				text.inputEl.maxLength = 100;
				text
					.setPlaceholder("e.g. Round 1 - Coding")
					.setValue(this.roundName)
					.onChange((value) => {
						this.roundName = value;
					});
			});

		// Date
		new Setting(contentEl)
			.setName("Date / Deadline")
			.setDesc("Interview date, or the OA due date")
			.addText((text) => {
				text.inputEl.type = "date";
				text.setValue(this.date).onChange((value) => {
					this.date = value;
				});
			});

		// Time
		new Setting(contentEl)
			.setName("Interview Time")
			.setDesc("Time and time zone (e.g. '2:00 PM EST')")
			.addText((text) => {
				text.inputEl.maxLength = 30;
				text.setPlaceholder("e.g. 2:00 PM EST").setValue(this.time).onChange((value) => {
					this.time = value;
				});
			});

		// Interviewers
		new Setting(contentEl)
			.setName("Interviewers / Panel")
			.setDesc("Names and roles of the interviewers")
			.addText((text) => {
				text.inputEl.maxLength = 200;
				text.setPlaceholder("e.g. Jane Smith (SWE II), John Doe (EM)").setValue(this.interviewers).onChange((value) => {
					this.interviewers = value;
				});
			});

		// Generate Prep Note Toggle
		new Setting(contentEl)
			.setName("Generate Interview Prep Note")
			.setDesc("Create a structured Markdown prep note for this interview using your template")
			.addToggle((toggle) =>
				toggle.setValue(this.createPrepNote).onChange((value) => {
					this.createPrepNote = value;
				})
			);

		// Update Status Toggle
		new Setting(contentEl)
			.setName("Advance Pipeline Status")
			.setDesc(this.describeAutoAdvance())
			.addToggle((toggle) =>
				toggle.setValue(this.autoAdvanceStatus).onChange((value) => {
					this.autoAdvanceStatus = value;
				})
			);

		// Submit button
		let submitBtn: ButtonComponent;
		new Setting(contentEl)
			.addButton((btn) => {
				submitBtn = btn;
				btn
					.setButtonText("Schedule Interview")
					.setCta()
					.onClick(async () => {
						submitBtn.setDisabled(true);
						await this.handleSubmit(submitBtn);
					});
			})
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				})
			);
	}

	private describeAutoAdvance(): string {
		if (!this.application) return "";
		const next = getAutoAdvanceStatus(this.application.status, this.roundType, this.plugin.settings.statuses);
		return next
			? `Move status from '${this.application.status}' to '${next}'`
			: `Status stays '${this.application.status}' (already at or past this stage)`;
	}

	private async handleSubmit(btn?: ButtonComponent): Promise<void> {
		if (!this.application) return;
		if (!this.roundName.trim()) {
			new Notice("Please enter a round name.");
			btn?.setDisabled(false);
			return;
		}
		if (this.date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(this.date.trim())) {
			new Notice("Please select a valid date for Interview Date.");
			btn?.setDisabled(false);
			return;
		}

		try {
			const interview: InterviewRound = {
				id: crypto.randomUUID(),
				roundName: this.roundName.trim(),
				roundType: this.roundType,
				date: this.date.trim() || undefined,
				time: this.time.trim() || undefined,
				interviewers: this.interviewers.trim() || undefined,
				status: "Scheduled",
			};

			const file = this.resolveApplicationFile();
			if (!file) {
				btn?.setDisabled(false);
				return;
			}

			const result = await this.plugin.appService.addInterviewToApplication(
				file,
				interview,
				this.createPrepNote,
				this.autoAdvanceStatus
			);

			this.isCompleted = true;
			this.close();
			if (this.onComplete) {
				this.onComplete();
			}

			// If prep note was generated, open it in a new workspace tab
			if (result.prepFile) {
				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.openFile(result.prepFile);
			}
		} catch (err) {
			btn?.setDisabled(false);
			this.handleModalError("Add interview", err);
		}
	}
}
