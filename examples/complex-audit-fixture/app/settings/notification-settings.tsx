"use client";

export function NotificationSettings() {
  function handleToggleNotifications(enabled: boolean) {
    setNotifications(enabled);
  }

  return <input type="checkbox" onChange={(event) => handleToggleNotifications(event.target.checked)} />;
}
