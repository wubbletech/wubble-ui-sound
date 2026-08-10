"use client";
import { feedback } from "./lib/wubble-ui-sounds.js";


const saveButton = document.querySelector("#after-save");
const log = document.querySelector("#after-log");
const state = document.querySelector("#after-state");

async function handleSaveProfile() {
  void feedback.processing();
  try {
    const wubbleResult = await (async () => {
      saveButton.disabled = true;
      state.textContent = "Saving";
      log.className = "event-log";
      log.innerHTML = "<strong>Saving.</strong> The visible state changes immediately.";
      await wait(520);
      state.textContent = "Saved";
      log.className = "event-log success";
      log.innerHTML = "<strong>Saved.</strong> The release notes are ready for review.";
      saveButton.disabled = false;
    })();
    void feedback.success();
    return wubbleResult;
  } catch (error) {
    void feedback.error();
    throw error;
  }
}

saveButton.addEventListener("click", () => void handleSaveProfile());

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
