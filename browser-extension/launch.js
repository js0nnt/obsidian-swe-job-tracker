const uri = decodeURIComponent(location.hash.slice(1));
const open = () => {
	if (uri.startsWith("obsidian://swe-job-tracker-add?")) location.href = uri;
};

// Close only once the user comes back to Chrome. Closing on the first blur would also fire when
// Chrome's "Open Obsidian?" dialog appears, killing the dialog before it can be answered.
let left = false;
const closeSelf = () => window.close();
window.addEventListener("blur", () => (left = true));
window.addEventListener("focus", () => left && closeSelf());
document.addEventListener("visibilitychange", () => {
	if (document.hidden) left = true;
	else if (left) closeSelf();
});

document.getElementById("retry").addEventListener("click", open);
document.getElementById("close").addEventListener("click", closeSelf);
open();
