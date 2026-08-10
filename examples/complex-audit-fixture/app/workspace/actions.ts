"use server";

export async function updateWorkspaceName(name: string) {
  await persistWorkspaceName(name);
}
