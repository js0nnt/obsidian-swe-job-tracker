// Shared by the options page and the autofill content script: storage keys and the profile schema.

const AUTOFILL_KEYS = {
	profile: "autofillProfile",
	resume: "autofillFile:resume",
	coverLetter: "autofillFile:coverLetter",
};

const AUTOFILL_MAX_FILE_BYTES = 4 * 1024 * 1024;

// Phrases sites use for "I'd rather not say" options.
const DECLINE_PHRASES = [
	"decline to self identify",
	"decline to answer",
	"decline",
	"prefer not to say",
	"prefer not to answer",
	"prefer not to disclose",
	"i don't wish to answer",
	"i do not wish to",
	"do not wish to",
	"don't wish to",
	"choose not to",
	"not to disclose",
	"not to answer",
];

const YES_NO = [
	{ value: "Yes", label: "Yes", match: ["yes"] },
	{ value: "No", label: "No", match: ["no"] },
];

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

/**
 * Field types: text (default), email, tel, url, textarea, select.
 * Select options carry `match` phrases used to pick the right option on sites that word it differently.
 */
const PROFILE_SECTIONS = [
	{
		title: "Personal",
		fields: [
			{ key: "firstName", label: "First name" },
			{ key: "lastName", label: "Last name" },
			{ key: "preferredName", label: "Preferred name", hint: "Blank uses your first name" },
			{ key: "email", label: "Email", type: "email" },
			{ key: "phone", label: "Phone", type: "tel" },
			{ key: "pronouns", label: "Pronouns", placeholder: "e.g. she/her" },
		],
	},
	{
		title: "Address",
		fields: [
			{ key: "street", label: "Street address" },
			{ key: "city", label: "City" },
			{ key: "state", label: "State / province", placeholder: "e.g. Arizona or AZ" },
			{ key: "zip", label: "ZIP / postal code" },
			{ key: "country", label: "Country", placeholder: "e.g. United States" },
		],
	},
	{
		title: "Links",
		fields: [
			{ key: "linkedin", label: "LinkedIn URL", type: "url" },
			{ key: "github", label: "GitHub URL", type: "url" },
			{ key: "portfolio", label: "Portfolio / website", type: "url" },
		],
	},
	{
		title: "Education",
		fields: [
			{ key: "school", label: "School" },
			{ key: "degree", label: "Degree", placeholder: "e.g. Bachelor's" },
			{ key: "major", label: "Major / field of study" },
			{ key: "gpa", label: "GPA", placeholder: "e.g. 3.8" },
			{
				key: "gradMonth",
				label: "Graduation month",
				type: "select",
				options: MONTHS.map((m, i) => ({ value: m, label: m, match: [m.slice(0, 3), String(i + 1).padStart(2, "0"), String(i + 1)] })),
			},
			{ key: "gradYear", label: "Graduation year", placeholder: "e.g. 2027" },
		],
	},
	{
		title: "Experience",
		fields: [
			{ key: "currentCompany", label: "Current / most recent company" },
			{ key: "currentTitle", label: "Current / most recent title" },
			{ key: "yearsExperience", label: "Years of experience", placeholder: "e.g. 2" },
		],
	},
	{
		title: "Work eligibility",
		fields: [
			{ key: "workAuthorized", label: "Authorized to work in the country of the job?", type: "select", options: YES_NO },
			{ key: "needsSponsorship", label: "Will you need visa sponsorship?", type: "select", options: YES_NO },
			{ key: "over18", label: "18 or older?", type: "select", options: YES_NO },
			{ key: "willingToRelocate", label: "Willing to relocate?", type: "select", options: YES_NO },
		],
	},
	{
		title: "Preferences",
		fields: [
			{ key: "desiredSalary", label: "Desired salary", placeholder: "e.g. 120000" },
			{ key: "startDate", label: "Earliest start date", placeholder: "e.g. June 2026 or Immediately" },
			{ key: "noticePeriod", label: "Notice period", placeholder: "e.g. 2 weeks" },
			{ key: "howHeard", label: "How you usually hear about jobs", placeholder: "e.g. LinkedIn" },
		],
	},
	{
		title: "Voluntary self-identification",
		note: "Optional. Leave a field blank and autofill skips it.",
		fields: [
			{
				key: "gender",
				label: "Gender",
				type: "select",
				options: [
					{ value: "Male", label: "Male", match: ["male", "man"] },
					{ value: "Female", label: "Female", match: ["female", "woman"] },
					{ value: "Non-binary", label: "Non-binary", match: ["non binary", "nonbinary", "non-binary"] },
					{ value: "Decline", label: "Decline to self-identify", match: DECLINE_PHRASES },
				],
			},
			{
				key: "hispanicLatino",
				label: "Hispanic or Latino?",
				type: "select",
				options: [...YES_NO, { value: "Decline", label: "Decline to self-identify", match: DECLINE_PHRASES }],
			},
			{
				key: "race",
				label: "Race / ethnicity",
				type: "select",
				options: [
					{ value: "American Indian or Alaska Native", label: "American Indian or Alaska Native", match: ["american indian", "alaska native"] },
					{ value: "Asian", label: "Asian", match: ["asian"] },
					{ value: "Black or African American", label: "Black or African American", match: ["black", "african american"] },
					{ value: "Hispanic or Latino", label: "Hispanic or Latino", match: ["hispanic", "latino"] },
					{ value: "Native Hawaiian or Other Pacific Islander", label: "Native Hawaiian or Other Pacific Islander", match: ["native hawaiian", "pacific islander"] },
					{ value: "White", label: "White", match: ["white"] },
					{ value: "Two or More Races", label: "Two or more races", match: ["two or more", "multiracial", "multiple"] },
					{ value: "Decline", label: "Decline to self-identify", match: DECLINE_PHRASES },
				],
			},
			{
				key: "veteran",
				label: "Veteran status",
				type: "select",
				options: [
					{ value: "No", label: "Not a protected veteran", match: ["i am not a protected veteran", "not a protected veteran", "not a veteran", "no"] },
					{ value: "Yes", label: "Protected veteran", match: ["identify as one or more", "i am a protected veteran", "i am a veteran", "yes"] },
					{ value: "Decline", label: "Decline to self-identify", match: DECLINE_PHRASES },
				],
			},
			{
				key: "disability",
				label: "Disability status",
				type: "select",
				options: [
					{ value: "No", label: "No disability", match: ["no, i do not have a disability", "i do not have a disability", "do not have a disability", "no"] },
					{ value: "Yes", label: "Have a disability", match: ["yes, i have a disability", "i have a disability", "yes"] },
					{ value: "Decline", label: "Decline to self-identify", match: DECLINE_PHRASES },
				],
			},
		],
	},
	{
		title: "Cover letter text",
		fields: [{ key: "coverLetterText", label: "Pasted into cover letter text boxes", type: "textarea" }],
	},
];

const PROFILE_FIELD_DEFS = Object.fromEntries(PROFILE_SECTIONS.flatMap((s) => s.fields).map((f) => [f.key, f]));
