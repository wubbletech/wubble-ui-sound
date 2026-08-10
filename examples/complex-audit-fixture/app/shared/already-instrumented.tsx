"use client";

import { feedback } from "@/lib/wubble-ui-sounds";

export function AlreadyInstrumented() {
  async function handleSaveNotificationRules() {
    await saveNotificationRules();
    void feedback.success();
  }

  return <button onClick={handleSaveNotificationRules}>Save rules</button>;
}
