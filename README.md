# SWE Job Tracker

A software-engineering fork of [Job Application Tracker](https://github.com/cruisencode/obsidian-job-application-tracker) (MIT) for Obsidian. It uses the pipeline that tech internship and new-grad searches actually follow:

```
Applied → OA → Recruiter Screen → Round 1 → Round 2 → Round 3 → Final Round → Offer → Accepted
                                                              ↘ Rejected / Withdrawn / Ghosted
```

## What's different from upstream

- **SWE pipeline statuses** instead of Wishlist / Screening / Interviewing. You can still edit the list in settings. Any status containing "Round", "Final", "Superday", "Onsite" and so on is treated as an interview stage, so custom rounds work in analytics too.
- **Interview types** built for tech: Online Assessment (OA), Take-Home, Recruiter Screen, Technical Phone Screen, Coding / DSA, System Design, Behavioral, Hiring Manager, Final Round / Superday, Team Match.
- **Auto-advance:** scheduling an OA moves the application to `OA`. Each technical round moves it to the next `Round N`, and a Superday moves it to `Final Round`. It never moves an application backwards, and it never changes an application that has an offer or is closed.
- **OA deadlines:** moving an application into `OA` asks when the assessment is due, either as a date or as "expires N days after the email", with an optional time for exact due times. An **OA Deadlines** list below the Kanban board shows pending assessments with the closest deadline first. The deadline is stored as `oaDeadline` (and `oaDeadlineTime`) in frontmatter.
- **Analytics:** OA rate, interview rate, and a **"Where Rejections Happen"** breakdown showing the last stage you reached before each rejection. The source table has an OA column.
- **Filters:** "Active (not closed)" and "Interviewing (any round)".
- **Prep note template** for coding interviews: platform and format, a DSA pattern checklist, a project deep-dive section, STAR stories, and a debrief (problems asked, complexity).
- **Sources:** Handshake, Simplify, GitHub internship lists, and Career Fair.

## Compatible with existing notes

Notes from the original plugin work as they are. This fork uses the same frontmatter (`type: job-application`, `status`, `statusHistory`, `interviews`, …) and the same default folder (`Job Applications`). Old statuses are translated when notes are read:

| Old          | New              |
|--------------|------------------|
| Wishlist     | Applied          |
| Screening    | OA               |
| Interviewing | Round 1          |

To rewrite old statuses in the files themselves, run **SWE Job Tracker: Migrate legacy statuses** from the command palette.

## Build and install

```bash
npm install
npm run build
npm run install-plugin -- "C:/path/to/vault"
```

Then enable **SWE Job Tracker** under Settings → Community plugins. Disable the original Job Application Tracker so you don't have two ribbon icons. Both plugins read the same notes, so nothing is lost.

For development, `npm run dev` watches and rebuilds `main.js`.
