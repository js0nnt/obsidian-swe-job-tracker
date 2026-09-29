import { getStageCategory } from "./stages";
import { DEFAULT_SANKEY_SETTINGS } from "./sankeySettings";
import { EmploymentType, JobApplicationTrackerSettings, JobStatus, WorkplaceType } from "./types";

export const VIEW_TYPE_JOB_TRACKER = "swe-job-tracker-view";

/**
 * Sanitizes a status string for safe usage in CSS class names.
 */
export function getStatusClassName(status: string): string {
	// Per-status class for exact colors, plus a category class so custom statuses still get themed.
	const slug = (status || "").toLowerCase().trim().replace(/[^a-z0-9-]/g, "-");
	return `status-${slug} stage-${getStageCategory(status)}`;
}

export const WORKPLACE_OPTIONS: readonly WorkplaceType[] = ["Remote", "Hybrid", "On-site"];
export const EMPLOYMENT_OPTIONS: readonly EmploymentType[] = ["Full-time", "Contract", "Part-time", "Internship"];

export const DEFAULT_STATUSES: JobStatus[] = [
	"Applied",
	"OA",
	"Recruiter Screen",
	"Round 1",
	"Round 2",
	"Round 3",
	"Final Round",
	"Offer",
	"Accepted",
	"Rejected",
	"Withdrawn",
	"Ghosted",
];

export const DEFAULT_SOURCE_OPTIONS: string[] = [
	"Company Website",
	"LinkedIn",
	"Handshake",
	"Simplify",
	"GitHub Internship List",
	"Referral",
	"Career Fair",
	"Recruiter Reachout",
	"Indeed",
	"Other",
];

export const DEFAULT_INTERVIEW_PREP_TEMPLATE = `---
type: interview-prep
company: "{{company}}"
role: "{{role}}"
round: "{{roundName}}"
date: "{{date}}"
---

# {{roundName}}: {{company}} ({{role}})

> **Date & Time:** {{date}} {{time}}  
> **Interviewers:** {{interviewers}}  
> **Application:** [[{{applicationNoteTitle}}]]

---

## 🧭 Round Format
- **Type:** OA / Phone Screen / Coding / System Design / Behavioral / Superday
- **Platform:** HackerRank / CodeSignal / CoderPad / Google Doc / Zoom / onsite
- **Duration & # of problems:** 
- **Language I'll use:** 
- **What the recruiter said to expect:** 

---

## 🏢 Company & Team
- **Product / what the team builds:** 
- **Tech stack:** 
- **Known interview style (Glassdoor / LeetCode Discuss / Reddit):** 

---

## 🧩 Coding / DSA Review
- [ ] Arrays & Hashing / Two Pointers / Sliding Window
- [ ] Stack / Binary Search / Linked List
- [ ] Trees / Tries / Heaps
- [ ] Graphs (BFS, DFS, Topological Sort, Union-Find)
- [ ] Dynamic Programming / Backtracking / Greedy / Intervals
- **Company-tagged problems to do:** 
- **Problems practiced:**
  1. 
  2. 
  3. 

**During the problem:** clarify inputs and edge cases → talk through brute force → optimize → code → walk through a test → state time/space complexity.

---

## 🏗️ System Design / Project Deep-Dive
- **Project I'll lead with:** 
- **Architecture, trade-offs, what I'd do differently:** 
- **Design topics to review (if applicable):** 

---

## 💡 Behavioral (STAR)
### Tell me about yourself (60–90s)
- 

### Challenging technical problem
- **Situation:** 
- **Task:** 
- **Action:** 
- **Result:** 

### Conflict / feedback / failure
- **Situation:** 
- **Task:** 
- **Action:** 
- **Result:** 

---

## ❓ Questions to Ask
1. What does a typical week look like for an intern or new grad on the team?
2. How are projects scoped, and how is success measured?
3. What does code review and mentorship look like?
4. What are the next steps and the timeline?

---

## 📝 Post-Interview Debrief
- **Problems asked:** 
- **How I did / where I got stuck:** 
- **Complexity I landed on vs optimal:** 
- **Follow-up / thank-you sent:** [ ] Yes  [ ] No
`;

export const DEFAULT_SETTINGS: JobApplicationTrackerSettings = {
	autoGhostEnabled: true,
	sankey: { ...DEFAULT_SANKEY_SETTINGS },
	trackerFolderPath: "Job Applications",
	interviewNotesFolderPath: "Job Applications/Interviews",
	attachmentsFolderPath: "Job Applications/Attachments",
	statuses: DEFAULT_STATUSES,
	defaultStatus: "Applied",
	interviewPrepTemplate: DEFAULT_INTERVIEW_PREP_TEMPLATE,
	defaultSourceOptions: DEFAULT_SOURCE_OPTIONS,
	openViewLocation: "tab",
};
