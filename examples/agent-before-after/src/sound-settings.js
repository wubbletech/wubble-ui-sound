import { setFeedbackEnabled, unlockFeedback } from "./lib/wubble-ui-sounds.js";

const control = document.querySelector("#sound-enabled");
const status = document.querySelector("#sound-status");

control.addEventListener("change", async () => {
  setFeedbackEnabled(control.checked);
  if (!control.checked) {
    status.textContent = "Sound is off. The after flow remains fully usable.";
    return;
  }
  const unlocked = await unlockFeedback();
  status.textContent = unlocked
    ? "Sound is on. Save in the after flow to hear local processing and success cues."
    : "Sound is enabled, but this browser has not unlocked audio yet. The flow still works normally.";
});
