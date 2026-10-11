import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found card">
      <span className="eyebrow">A LITTLE OUTSIDE THE CIRCLE</span>
      <h1>This page wandered off.</h1>
      <p>It may have moved, or it may no longer be available.</p>
      <Link href="/" className="button">
        Back to your feed
      </Link>
    </main>
  );
}
