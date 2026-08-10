import "./styles.css";

export const metadata = {
  title: "Wubble UI Sounds - Next.js Example",
  description: "A local-first Wubble feedback integration for the Next.js App Router."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
