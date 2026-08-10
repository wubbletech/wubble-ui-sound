"use client";

export function MessageComposer() {
  function handleSendMessage() {
    sendMessage();
  }

  function handleOpenAttachments() {
    setAttachmentPickerOpen(true);
  }

  function handleCloseAttachments() {
    setAttachmentPickerOpen(false);
  }

  return <button onClick={handleSendMessage}>Send</button>;
}
