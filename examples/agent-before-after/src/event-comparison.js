import { feedback } from "./lib/wubble-ui-sounds.js";

const events = [
  { key: "tap", label: "Tap", moment: "A direct action is acknowledged." },
  { key: "toggleOn", label: "Toggle on", moment: "A setting becomes enabled." },
  { key: "toggleOff", label: "Toggle off", moment: "A setting becomes disabled." },
  { key: "select", label: "Select", moment: "A choice is committed." },
  { key: "open", label: "Open", moment: "A panel or surface appears." },
  { key: "close", label: "Close", moment: "A panel or surface is dismissed." },
  { key: "navigate", label: "Navigate", moment: "The product moves to a destination." },
  { key: "success", label: "Success", moment: "A meaningful action completed correctly." },
  { key: "error", label: "Error", moment: "An action needs correction." },
  { key: "warning", label: "Warning", moment: "Attention is useful before a decision." },
  { key: "notify", label: "Notify", moment: "A new non-blocking item arrived." },
  { key: "send", label: "Send", moment: "Content left the current user." },
  { key: "receive", label: "Receive", moment: "Content reached the current user." },
  { key: "processing", label: "Processing", moment: "Work started without a visual interruption." },
  { key: "complete", label: "Complete", moment: "A longer task reached its end." },
  { key: "deleteConfirm", label: "Delete confirmed", moment: "A destructive action finished." }
];

const list = document.querySelector("#event-list");
const status = document.querySelector("#catalog-status");

for (const event of events) {
  const row = document.createElement("li");
  row.className = "event-row";
  row.innerHTML = `
    <div class="event-name"><strong>${event.label}</strong><span>${event.moment}</span></div>
    <button class="before-event" type="button">Visible only</button>
    <button class="after-event" type="button">Audition sound</button>
  `;
  row.querySelector(".before-event").addEventListener("click", () => {
    status.innerHTML = `<strong>${event.label}:</strong> the visible product acknowledgement occurred. No sound was played.`;
  });
  row.querySelector(".after-event").addEventListener("click", async () => {
    feedback.stopAll();
    const result = await feedback[event.key]();
    status.innerHTML = result.played
      ? `<strong>${event.label}:</strong> the same visible acknowledgement occurred and its local cue played.`
      : `<strong>${event.label}:</strong> the visible acknowledgement occurred. No cue played: ${result.reason}.`;
  });
  list.append(row);
}
