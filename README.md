# SWE Job Tracker

A software-engineering fork of [Job Application Tracker](https://github.com/cruisencode/obsidian-job-application-tracker) (MIT) for Obsidian. It uses the pipeline that tech internship and new-grad searches actually follow:

```
Applied → OA → Recruiter Screen → Round 1 → Round 2 → Round 3 → Final Round → Offer → Accepted
                                                              ↘ Rejected / Withdrawn / Ghosted
```

To rewrite old statuses in the files themselves, run **SWE Job Tracker: Migrate legacy statuses** from the command palette.

## Build and install

```bash
npm install
npm run build
npm run install-plugin -- "C:/path/to/vault"
```

Then enable **SWE Job Tracker** under Settings → Community plugins. Disable the original Job Application Tracker so you don't have two ribbon icons. Both plugins read the same notes, so nothing is lost.

For development, `npm run dev` watches and rebuilds `main.js`.
