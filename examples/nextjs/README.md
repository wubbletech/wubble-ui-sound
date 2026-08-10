# Next.js App Router Example

This example keeps `app/page.js` as a Server Component and places every browser-audio interaction inside `app/feedback-demo.js`, a Client Component.

```bash
npm install
npm run dev --workspace @wubble/nextjs-example
```

The local sample files belong in `public/wubble/signal/`. In a real application, use the Wubble CLI export flow; it creates content-hashed asset filenames so audio can be cached for a long time while `manifest.json` is revalidated more frequently.

`FeedbackSettings` keeps the preference off by default, persists the user's choice in local storage, and unlocks audio from the enabling user gesture. The application still provides complete visual feedback when sound is disabled or unavailable.
