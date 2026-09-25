import { App, FuzzySuggestModal, Notice, TFile } from "obsidian";
import JobApplicationTrackerPlugin from "../main";
import { JobApplication, JobStatus } from "../types";
import { moveApplicationToStatus } from "./OADeadlineModal";

/** Quick picker for moving an application between the configured Kanban bins. */
export class MoveToBinModal extends FuzzySuggestModal<JobStatus> {
	private readonly statuses: JobStatus[];

	constructor(
		app: App,
		private readonly plugin: JobApplicationTrackerPlugin,
		private readonly application: JobApplication
	) {
		super(app);
		this.statuses = plugin.settings.statuses.filter((status) => status !== application.status);
		this.setPlaceholder(`Move ${application.company} to a bin...`);
		this.emptyStateText = "No other bins are configured.";
	}

	getItems(): JobStatus[] {
		return this.statuses;
	}

	getItemText(status: JobStatus): string {
		return status;
	}

	onChooseItem(status: JobStatus): void {
		const file = this.plugin.appService.resolveFile(this.application.filePath);
		if (!(file instanceof TFile)) {
			new Notice("Could not find the application note.");
			return;
		}

		void moveApplicationToStatus(this.app, this.plugin, this.application, file, status);
	}
}
