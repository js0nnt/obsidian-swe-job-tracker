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

It fills company, role, location, employment type, salary, job URL, and the job description. Salary is read from the posting's structured data, the description, and any pay-transparency block on the page. Hourly, weekly, monthly and yearly pay are each shown as one lowest-to-highest range, for example `$55 - $62 / hour · $115,000 - $200,000 / year`, so per-location ranges collapse into a single span. Location lists every place the posting names, including the locations attached to per-location pay ranges. Pages that include schema.org `JobPosting` data (Lever, Ashby, Workday, and many company career sites) parse best. Greenhouse boards, including boards embedded on company sites (`?gh_jid=`), are read from Greenhouse's public job API. Other career sites fall back to the page heading for the role and the page title, logo or domain for the company. LinkedIn and Indeed use page scrapers, which can break when those sites change their markup.

Before showing the card, the extension asks Obsidian whether the job is already in your vault (same posting URL, same Greenhouse job, or same company and role). If it is, the card stays hidden. **Skip this job** (or ×) hides the card for that job for good. When Obsidian isn't running, the extension also skips jobs you already sent from this browser. To parse a job anyway, click the extension's toolbar icon and choose **Send this job to Obsidian**; the card then says if the job is already tracked. Obsidian opens the link in the vault you last used, so that vault needs the plugin enabled.

The vault check is a small server the plugin runs on `127.0.0.1:27125` (desktop only). It only answers requests from browser extensions, never from web pages, and you can turn it off under **Settings → SWE Job Tracker → Browser extension**. With more than one vault open, the first one to start answers.

### Autofill job applications

The extension can also fill in application forms for you.

1. Click the toolbar icon, then **Edit autofill profile**. Enter your details: contact info, address, links, education, work eligibility, optional EEO answers, your resume and cover letter files, and **custom answers** for questions the profile doesn't cover. If a question's label contains one of your phrases (for example `security clearance`), autofill uses that answer. Everything is stored locally in Chrome and saves as you type.
2. On an application form, click the toolbar icon, then **Autofill this application**, or press **Alt+Shift+F**.
3. A panel in the top-right lists:
   - **Not filled · required**: required fields autofill couldn't answer, like open-ended questions or consent checkboxes.
   - **Check these**: fields that were filled but deserve a look. That covers a dropdown where it picked the closest option, a site that rewrote or rejected a value, a field matched only by its hidden name, a number field that dropped part of your answer, or an attached file.
   - **Not filled · optional** and **Filled**, collapsed.

   Problem fields are outlined on the page (red for not filled, amber for check). Click an item to scroll to it. **Run again** helps with multi-step forms like Workday.

Autofill never submits anything.
