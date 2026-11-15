// Hydrates the sign-in form (until this runs, submitting just reloads the page).
const form = document.getElementById("signin");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetch("/api/session", { method: "POST" });
  location.assign("/app");
});
