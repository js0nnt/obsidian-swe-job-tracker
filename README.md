# SWE Job Tracker

A software-engineering fork of [Job Application Tracker](https://github.com/cruisencode/obsidian-job-application-tracker) (MIT) for Obsidian. It uses the pipeline that tech internship and new-grad searches actually follow:

```
Applied → OA → Recruiter Screen → Round 1 → Round 2 → Round 3 → Final Round → Offer → Accepted
                                                              ↘ Rejected / Withdrawn / Ghosted
```

## Migrating old statuses

Notes created with the original Job Application Tracker use older statuses. The plugin already reads them as the new ones, so nothing breaks, but you can rewrite the notes themselves:

| Old status | Becomes |
|---|---|
| Wishlist | Applied |
| Screening | OA |
| Interviewing | Round 1 |

1. Back up your vault or commit it to git, since this edits your notes.
2. Open the command palette (`Ctrl/Cmd+P`).
3. Run **SWE Job Tracker: Migrate legacy statuses (Screening → OA, Interviewing → Round 1)**.
4. A notice shows how many notes were changed, or "No legacy statuses found."

It updates both each note's current status and its status history, and it is safe to run again.

## Build and install

```bash
npm install
npm run build
npm run install-plugin -- "C:/path/to/vault"
```

Then enable **SWE Job Tracker** under Settings → Community plugins. Disable the original Job Application Tracker so you don't have two ribbon icons. Both plugins read the same notes, so nothing is lost.

For development, `npm run dev` watches and rebuilds `main.js`.

## Browser extension (clip jobs from Chrome)

`browser-extension/` is a Chrome extension that detects job postings and pre-fills the **Add New Job Application** form in Obsidian. It never saves anything itself: you review the fields in Obsidian and click **Create Application**.

1. Build and install the plugin (above) so Obsidian knows the `obsidian://swe-job-tracker-add` link.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `browser-extension` folder.
3. Open a job posting. A card in the top-right asks **Parse this job into Obsidian?** Click **Parse**.
4. The first time, Chrome asks to open Obsidian. Tick **Always allow** so it doesn't ask again.

It fills company, role, location, employment type, salary, job URL, and the job description. Pages that include schema.org `JobPosting` data (Greenhouse, Lever, Ashby, Workday, and many company career sites) parse best. LinkedIn and Indeed use page scrapers, which can break when those sites change their markup.

If the card doesn't appear, click the extension's toolbar icon to parse the page anyway (it falls back to the page's heading). Obsidian opens the link in the vault you last used, so that vault needs the plugin enabled.
