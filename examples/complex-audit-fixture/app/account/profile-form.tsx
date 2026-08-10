"use client";

export function ProfileForm() {
  async function handleSaveProfile() {
    await saveProfile();
  }

  async function handleUploadAvatar(file: File) {
    await uploadAvatar(file);
  }

  function handleSearchTeams(query: string) {
    setTeamQuery(query);
  }

  return <form onSubmit={handleSaveProfile}><button>Save profile</button><button>Help</button></form>;
}
