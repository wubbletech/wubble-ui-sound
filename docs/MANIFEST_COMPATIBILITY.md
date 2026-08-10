# Manifest Compatibility

Customer manifests are a versioned local contract. The current public SDK supports schema version `1`.

## Rules

- A manifest at the current version validates normally.
- A newer schema version is rejected. A newer release must not be guessed or partially interpreted by an older SDK.
- An older schema version is rejected until the SDK contains a named, deterministic migration for it.
- A migration must be tested, documented, and released with the SDK before it is used in a customer export or signed archive installation.
- Archive signatures cover the original manifest. Verification happens before compatibility handling; a future migration is an explicit local transformation after signature verification.

`migrateManifest()` is the compatibility gate. Version `1` passes through unchanged today. Its explicit result is intentional: it makes the unsupported paths fail safely now and gives a future migration one tested home rather than scattering version checks through runtimes and the CLI.

No compatibility claim is made for a future schema until that release includes the actual migration, fixture coverage, and upgrade notes.
