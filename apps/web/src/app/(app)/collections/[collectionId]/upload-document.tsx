'use client';

import type { DocumentView, UploadPolicy } from '@verarag/contracts';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import ui from '@/components/ui.module.css';
import { isApiError } from '@/lib/api-error';
import { acceptAttribute, precheckFile, supportedSummary } from '@/lib/documents';
import { formatBytes } from '@/lib/format';

import list from '../collections.module.css';

/**
 * Only states that really happen. The percentage is the share of the file
 * the browser has sent; the chain behind it streams with backpressure, so
 * it follows the upload to storage closely. Once everything is sent, the
 * API still writes the last part and checks it: that is "Saving".
 */
type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; name: string; percent: number }
  | { phase: 'saving'; name: string }
  | { phase: 'uploaded'; name: string }
  | { phase: 'failed'; name?: string; message: string };

export function UploadDocument({
  organizationId,
  collectionId,
  policy,
}: {
  organizationId: string;
  collectionId: string;
  policy: UploadPolicy;
}) {
  const router = useRouter();
  const inputId = useId();
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const busy = state.phase === 'uploading' || state.phase === 'saving';

  function start(file: File | undefined) {
    if (!file || busy) return;
    const problem = precheckFile(file, policy);
    if (problem) {
      setState({ phase: 'failed', name: file.name, message: problem });
      return;
    }

    const form = new FormData();
    form.append('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open(
      'POST',
      `/api/v1/organizations/${organizationId}/collections/${collectionId}/documents`,
    );
    request.setRequestHeader('Accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      if (event.loaded >= event.total) {
        setState({ phase: 'saving', name: file.name });
      } else {
        setState({
          phase: 'uploading',
          name: file.name,
          percent: Math.floor((event.loaded / event.total) * 100),
        });
      }
    };
    request.upload.onload = () => setState({ phase: 'saving', name: file.name });
    request.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(request.responseText) as unknown;
      } catch {
        body = undefined;
      }
      if (request.status === 201) {
        setState({ phase: 'uploaded', name: (body as DocumentView).filename });
        router.refresh();
        return;
      }
      setState({
        phase: 'failed',
        name: file.name,
        message: isApiError(body) ? body.error.message : 'The upload failed. Try again.',
      });
      router.refresh();
    };
    request.onerror = () =>
      setState({
        phase: 'failed',
        name: file.name,
        message: 'The connection was lost during the upload. Try again.',
      });
    setState({ phase: 'uploading', name: file.name, percent: 0 });
    request.send(form);
  }

  return (
    <div>
      <div
        className={list.dropZone}
        data-active={dragging}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          start(event.dataTransfer.files[0]);
        }}
      >
        <span>Drop a file here</span>
        <span>or</span>
        <label htmlFor={inputId} className={`${ui.button} ${ui.secondary}`}>
          Select a file
        </label>
        <input
          id={inputId}
          type="file"
          accept={acceptAttribute(policy)}
          className={ui.visuallyHidden}
          disabled={busy}
          onChange={(event) => {
            start(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <span className={ui.hint}>
          {supportedSummary(policy)}. Up to {formatBytes(policy.maxSizeBytes)}.
        </span>
      </div>

      <div className={list.uploadState} aria-live="polite">
        {state.phase === 'uploading' ? (
          <>
            <span>
              {state.name} — Uploading… {state.percent}%
            </span>
            <div
              className={list.progress}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
              aria-label={`Uploading ${state.name}`}
            >
              <div className={list.progressBar} style={{ width: `${state.percent}%` }} />
            </div>
          </>
        ) : null}
        {state.phase === 'saving' ? <span>{state.name} — Saving…</span> : null}
        {state.phase === 'uploaded' ? (
          <p className={ui.success} role="status">
            {state.name} — Uploaded
          </p>
        ) : null}
        {state.phase === 'failed' ? (
          <p className={ui.alert} role="alert">
            {state.name ? `${state.name}: ` : ''}
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
