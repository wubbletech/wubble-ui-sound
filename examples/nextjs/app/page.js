import { FeedbackDemo } from "./feedback-demo";

export default function Page() {
  return (
    <main>
      <header>
        <p className="eyebrow">Next.js App Router</p>
        <h1>Contextual product feedback</h1>
        <p className="intro">Review changes, share feedback, and keep the release moving.</p>
      </header>
      <FeedbackDemo />
    </main>
  );
}
