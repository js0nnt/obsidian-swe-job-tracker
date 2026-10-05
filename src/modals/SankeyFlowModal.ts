import { App, Modal } from "obsidian";
import { getStatusClassName } from "../constants";
import { JobApplication } from "../types";

/** Lists the applications that moved through one Sankey flow; selecting one opens its note. */
export class SankeyFlowModal extends Modal {
	constructor(
		app: App,
		private readonly source: string,
		private readonly target: string,
		private readonly applications: JobApplication[],
		private readonly openNote: (filePath: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("job-tracker-flow-modal");
		contentEl.createEl("h2", { text: `${this.source} → ${this.target}` });
		const count = this.applications.length;
		contentEl.createEl("p", {
			text: `${count} application${count === 1 ? "" : "s"} moved through this step.`,
			cls: "job-tracker-modal-subtitle",
		});

		const list = contentEl.createDiv({ cls: "job-tracker-flow-list" });
		const sorted = [...this.applications].sort((a, b) => a.company.localeCompare(b.company) || a.role.localeCompare(b.role));
		for (const application of sorted) {
			const row = list.createDiv({ cls: "job-tracker-flow-row", attr: { role: "button", tabindex: "0" } });
			const info = row.createDiv({ cls: "job-tracker-flow-info" });
			info.createSpan({ text: application.company, cls: "job-tracker-flow-company" });
			info.createSpan({ text: application.role, cls: "job-tracker-flow-role" });
			if (application.dateApplied) row.createSpan({ text: application.dateApplied, cls: "job-tracker-flow-date" });
			row.createSpan({ text: application.status, cls: `job-tracker-badge ${getStatusClassName(application.status)}` });
			const open = () => {
				this.close();
				this.openNote(application.filePath);
			};
			row.onclick = open;
			row.onkeydown = (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					open();
				}
			};
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
