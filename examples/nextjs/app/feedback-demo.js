"use client";

import { useState } from "react";
import { FeedbackProvider, FeedbackSettings, useAsyncFeedback, useFeedback } from "@wubble/react";
import { signalManifest } from "../src/lib/signal-manifest";

const actionGroups = [
  {
    label: "Interactions",
    actions: [
      { event: "tap", label: "Tap" },
      { event: "toggleOn", label: "Toggle on" },
      { event: "toggleOff", label: "Toggle off" },
      { event: "select", label: "Select" },
      { event: "open", label: "Open" },
      { event: "close", label: "Close" },
      { event: "navigate", label: "Navigate" }
    ]
  },
  {
    label: "States",
    actions: [
      { event: "success", label: "Success" },
      { event: "error", label: "Error" },
      { event: "warning", label: "Warning" },
      { event: "notify", label: "Notify" },
      { event: "complete", label: "Complete" },
      { event: "deleteConfirm", label: "Delete confirmed" }
    ]
  },
  {
    label: "Flow",
    actions: [
      { event: "send", label: "Send" },
      { event: "receive", label: "Receive" },
      { event: "processing", label: "Processing" }
    ]
  }
];

export function FeedbackDemo() {
  return (
    <FeedbackProvider manifest={signalManifest} baseUrl="/wubble/signal" storageKey="nextjs-example.feedback.enabled">
      <section className="feedback-panel" aria-labelledby="feedback-title">
        <div className="feedback-heading">
          <p className="eyebrow">Settings</p>
          <h2 id="feedback-title">Feedback controls</h2>
        </div>
        <FeedbackSettings />
        <ContextPreview />
        <ReferenceControls />
      </section>
    </FeedbackProvider>
  );
}

function ContextPreview() {
  const { play } = useFeedback();
  const save = useAsyncFeedback();
  const submit = useAsyncFeedback({ pendingEvent: "send", successEvent: "complete" });
  const [view, setView] = useState("Overview");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("No new notifications.");
  const [inboxCount, setInboxCount] = useState(2);
  const [deleteArmed, setDeleteArmed] = useState(false);

  async function changeView(nextView) {
    await play("navigate");
    setView(nextView);
  }

  async function saveDraft() {
    await save.run(async () => {
      await wait(260);
      return "saved";
    });
    setNotice("Draft saved. Visual confirmation remains available with sound off.");
  }

  async function submitMessage(event) {
    event.preventDefault();
    if (!message.trim()) {
      await play("error");
      setNotice("Write a message before sending.");
      return;
    }

    await submit.run(async () => {
      await wait(240);
      return "sent";
    });
    setMessage("");
    setNotice("Message sent to the review team.");
  }

  async function showNotice() {
    await play("notify");
    setNotice("New review is ready.");
  }

  async function receiveItem() {
    await play("receive");
    setInboxCount((count) => count + 1);
    setNotice("A new item reached your inbox.");
  }

  async function toggleDelete() {
    if (deleteArmed) {
      await play("close");
      setDeleteArmed(false);
      setNotice("Draft retained.");
      return;
    }
    await play("warning");
    setDeleteArmed(true);
    setNotice("Confirm removal only if this draft is no longer needed.");
  }

  async function confirmDelete() {
    await play("deleteConfirm");
    setDeleteArmed(false);
    setNotice("Draft removed. This message is still visible without audio.");
  }

  return (
    <section className="context-preview" aria-labelledby="context-preview-title">
      <div className="context-header">
        <div>
          <p className="eyebrow">Context preview</p>
          <h2 id="context-preview-title">Release workspace</h2>
        </div>
        <div className="inbox-count" aria-label={`${inboxCount} inbox items`}>Inbox {inboxCount}</div>
      </div>

      <nav className="preview-tabs" aria-label="Workspace views">
        {["Overview", "Activity"].map((item) => (
          <button
            key={item}
            type="button"
            className={view === item ? "tab-active" : undefined}
            aria-current={view === item ? "page" : undefined}
            onClick={() => void changeView(item)}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="preview-content">
        <div>
          <p className="preview-label">Current view</p>
          <h3>{view}</h3>
          <p className="preview-copy">Two reviewers have left feedback since your last visit.</p>
        </div>
        <button type="button" className="primary-action" disabled={save.status === "pending"} onClick={() => void saveDraft()}>
          {save.status === "pending" ? "Saving" : "Save draft"}
        </button>
      </div>

      <form className="message-form" onSubmit={(event) => void submitMessage(event)}>
        <label htmlFor="review-message">Review message</label>
        <div className="form-row">
          <input
            id="review-message"
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder="Add a note for the team"
          />
          <button type="submit" disabled={submit.status === "pending"}>
            {submit.status === "pending" ? "Sending" : "Send note"}
          </button>
        </div>
      </form>

      <div className="preview-actions">
        <button type="button" onClick={() => void showNotice()}>Show toast</button>
        <button type="button" onClick={() => void receiveItem()}>Receive item</button>
        <button type="button" className="danger-action" onClick={() => void toggleDelete()}>
          {deleteArmed ? "Keep draft" : "Remove draft"}
        </button>
        {deleteArmed && <button type="button" className="danger-action" onClick={() => void confirmDelete()}>Confirm removal</button>}
      </div>
      <p className="status" aria-live="polite">{notice}</p>
    </section>
  );
}

function ReferenceControls() {
  const { play, quietMode, setQuietMode } = useFeedback();
  const [status, setStatus] = useState("Choose an event to hear its local reference asset.");

  async function handleAction(eventName) {
    const result = await play(eventName);
    setStatus(result.played ? `${eventName} played from a local asset.` : `No sound played: ${result.reason}.`);
  }

  async function handleRapidTap() {
    const results = [await play("tap"), await play("tap"), await play("tap")];
    setStatus(`Rapid tap: ${results.map((result) => result.played ? "played" : result.reason).join(", ")}.`);
  }

  async function handleFlow() {
    const processing = await play("processing");
    const success = await play("success");
    setStatus(`Flow: processing ${processing.played ? "played" : processing.reason}; success ${success.played ? "played" : success.reason}.`);
  }

  return (
    <section className="reference-controls" aria-label="Reference controls">
      <div className="reference-heading">
        <div>
          <p className="eyebrow">Reference pack</p>
          <h2>Event coverage</h2>
        </div>
        <label className="quiet-toggle">
          <input type="checkbox" checked={quietMode} onChange={(event) => setQuietMode(event.currentTarget.checked)} />
          Quiet context
        </label>
      </div>
      <div className="action-groups">
        {actionGroups.map((group) => (
          <section key={group.label} className="action-group" aria-label={group.label}>
            <p>{group.label}</p>
            <div className="actions">
              {group.actions.map(({ event, label }) => (
                <button key={event} type="button" onClick={() => void handleAction(event)}>{label}</button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="policy-actions">
        <div>
          <p>Policy checks</p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => void handleRapidTap()}>Rapid tap</button>
          <button type="button" onClick={() => void handleFlow()}>Processing then success</button>
        </div>
      </div>
      <p className="status" aria-live="polite">{status}</p>
    </section>
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
