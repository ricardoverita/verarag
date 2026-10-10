import Link from 'next/link';
import { Suspense } from 'react';

import ui from '@/components/ui.module.css';
import { getSession } from '@/lib/session';

import { AutoRefresh } from './auto-refresh';
import styles from './page.module.css';
import { SystemStatusPanel, SystemStatusPlaceholder } from './system-status-panel';

const PIPELINE = [
  'Sources',
  'Documents',
  'Ingestion',
  'Chunking',
  'Embeddings',
  'Retrieval',
  'Reranking / Evidence',
  'LLM',
  'Answer + sources',
];

const DEV_EVENT_COMMAND = `curl -X POST http://localhost:3001/api/v1/dev/events \\
  -H 'Content-Type: application/json' \\
  -d '{"type": "system.test", "message": "hello from VeraRAG"}'`;

async function AccountActions() {
  const session = await getSession().catch(() => null);
  if (session) {
    return (
      <div className={styles.actions}>
        <Link href="/dashboard" className={ui.button}>
          Open dashboard
        </Link>
        <span className={styles.signedInAs}>Signed in as {session.user.displayName}</span>
      </div>
    );
  }
  return (
    <div className={styles.actions}>
      <Link href="/register" className={ui.button}>
        Create an account
      </Link>
      <Link href="/login" className={`${ui.button} ${ui.secondary}`}>
        Sign in
      </Link>
    </div>
  );
}

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <span className={styles.wordmark}>VeraRAG</span>
        <span className={styles.phase}>Phase 1 · Organizations and access</span>
      </header>

      <section className={styles.intro}>
        <h1>A private knowledge platform built on retrieval.</h1>
        <p>
          VeraRAG is meant to let an organization connect its documents and internal sources, search
          them and ask questions about them, keeping permissions, sources and the separation between
          organizations.
        </p>
        <p className={styles.notice}>
          It is at an early stage. You can create an account, organizations and API keys, and invite
          people, but it is not a production RAG platform yet: there is no ingestion, search or chat
          today.
        </p>
        <Suspense fallback={<div className={ui.skeleton} style={{ width: 260, height: 38 }} />}>
          <AccountActions />
        </Suspense>
      </section>

      <section className={styles.card} aria-labelledby="status-title">
        <h2 id="status-title">System status</h2>
        <Suspense fallback={<SystemStatusPlaceholder />}>
          <SystemStatusPanel refreshSeconds={10} />
        </Suspense>
        <AutoRefresh intervalMs={10_000} />
      </section>

      <section className={styles.card} aria-labelledby="pipeline-title">
        <h2 id="pipeline-title">Where it is heading</h2>
        <p>
          The path a question will take. None of these stages exist yet; each one has its own phase
          in the roadmap.
        </p>
        <ol className={styles.pipeline}>
          {PIPELINE.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ol>
      </section>

      <section className={styles.card} aria-labelledby="events-title">
        <h2 id="events-title">Check the event flow</h2>
        <p>
          With <code>DEV_ENDPOINTS_ENABLED=true</code>, the API exposes a development endpoint that
          publishes a <code>system.test</code> event to NATS JetStream. The Go worker consumes it
          and writes a structured log line (<code>docker compose logs worker</code>).
        </p>
        <pre className={styles.code}>{DEV_EVENT_COMMAND}</pre>
      </section>

      <footer className={styles.footer}>
        <span>Apache License 2.0</span>
        <a href="https://github.com/ricardoverita/verarag">Source code</a>
        <span>
          Started by <a href="https://www.ricardovera.dev">Ricardo Vera</a>
        </span>
      </footer>
    </main>
  );
}
