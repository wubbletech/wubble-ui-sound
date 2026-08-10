"use client";

export function PublishButton() {
  return <button onClick={async () => { await publishReport(); }}>Publish report</button>;
}
