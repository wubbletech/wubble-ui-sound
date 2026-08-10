import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Small, labeled fixtures used to prevent accidental scanner regressions.
 * This is deliberately a controlled corpus, not a claim about arbitrary code.
 */
export const auditCorpus = [
  { file: "save.jsx", expected: ["processing", "success", "error"], source: `export async function handleSaveProfile() { await saveProfile(); }` },
  { file: "submit.jsx", expected: ["processing", "success", "error"], source: `const handleSubmitInvoice = async () => { await submitInvoice(); };` },
  { file: "publish.jsx", expected: ["processing", "success", "error"], source: `export function Publish() { return <button onClick={async () => { await publish(); }}>Publish</button>; }` },
  { file: "delete.jsx", expected: ["deleteConfirm"], source: `function handleDeleteWorkspace() { destroyWorkspace(); }` },
  { file: "send.jsx", expected: ["send"], source: `function handleSendMessage() { sendMessage(); }` },
  { file: "toggle.jsx", expected: ["toggleOn", "toggleOff"], source: `function handleToggleNotifications() { setNotifications(true); }` },
  { file: "open.jsx", expected: ["open"], source: `function handleOpenMenu() { setOpen(true); }` },
  { file: "close.jsx", expected: ["close"], source: `function handleCloseDialog() { setOpen(false); }` },
  { file: "toast-success.jsx", expected: ["success"], source: `toast.success("Saved");` },
  { file: "toast-error.jsx", expected: ["error"], source: `toast.error("Failed");` },
  { file: "toast-warning.jsx", expected: ["warning"], source: `toast.warning("Check this");` },
  { file: "toast-info.jsx", expected: ["notify"], source: `toast.info("New message");` },
  { file: "navigate.jsx", expected: ["navigate"], source: `router.push("/settings");` },
  { file: "history.jsx", expected: ["navigate"], source: `history.replaceState({}, "", "/settings");` },
  { file: "update.jsx", expected: ["processing", "success", "error"], source: `async function onUpdatePreferences() { await updatePreferences(); }` },
  { file: "create.jsx", expected: ["processing", "success", "error"], source: `async function handleCreateProject() { await createProject(); }` },
  { file: "upload.jsx", expected: ["processing", "success", "error"], source: `async function handleUploadAvatar() { await uploadAvatar(); }` },
  { file: "native.jsx", expected: ["processing", "success", "error"], source: `export function Save() { return <Pressable onPress={async () => { await save(); }}>Save</Pressable>; }` },
  { file: "message.vue", expected: ["send"], source: `<button @click="sendMessage">Send</button>` },
  { file: "generic.jsx", expected: [], source: `export function Help() { return <button>Help</button>; }` },
  { file: "search.jsx", expected: [], source: `function handleSearchInput(value) { setQuery(value); }` },
  { file: "hover.jsx", expected: [], source: `function handleMouseOver() { setHover(true); }` },
  { file: "existing.jsx", expected: [], source: `import { createFeedbackClient } from "@wubble/ui-sounds"; async function handleSave() { await save(); }` }
];

export async function writeAuditCorpus(directory) {
  const expected = [];
  for (const fixture of auditCorpus) {
    const target = path.join(directory, fixture.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${fixture.source}\n`, "utf8");
    if (fixture.expected.length > 0) expected.push({ file: fixture.file, events: fixture.expected });
  }
  return expected;
}
