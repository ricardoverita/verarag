'use client';

import { useId, useState } from 'react';

import styles from './copy-field.module.css';
import ui from './ui.module.css';

/** A read-only value with a button to copy it, for links and keys shown once. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);

  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={id}
          className={`${ui.input} ${styles.value}`}
          value={value}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
