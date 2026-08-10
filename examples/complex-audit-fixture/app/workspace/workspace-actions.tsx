"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function WorkspaceActions() {
  const router = useRouter();

  function handleDeleteWorkspace() {
    destroyWorkspace();
  }

  function showImportComplete() {
    toast.success("Import complete");
  }

  function handleOpenProject() {
    router.push("/projects/atlas");
  }

  return <><button onClick={handleDeleteWorkspace}>Delete workspace</button><button onClick={handleOpenProject}>Open project</button></>;
}
