const saveButton = document.querySelector("#before-save");
const log = document.querySelector("#before-log");
const state = document.querySelector("#before-state");

async function handleSaveBefore() {
  saveButton.disabled = true;
  state.textContent = "Saving";
  log.className = "event-log";
  log.innerHTML = "<strong>Saving.</strong> The visible state changes immediately.";
  await wait(520);
  state.textContent = "Saved";
  log.className = "event-log success";
  log.innerHTML = "<strong>Saved.</strong> The release notes are ready for review. No audio was played.";
  saveButton.disabled = false;
}

saveButton.addEventListener("click", () => void handleSaveBefore());

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
