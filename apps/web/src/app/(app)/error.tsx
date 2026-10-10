'use client';

import ui from '@/components/ui.module.css';

export default function AppError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <section className={ui.card} role="alert">
      <h2>This page could not be loaded</h2>
      <p>VeraRAG did not answer as expected. It may be restarting; try again in a moment.</p>
      <button type="button" className={ui.button} onClick={() => retry()}>
        Try again
      </button>
    </section>
  );
}
