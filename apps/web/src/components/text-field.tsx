import { useId } from 'react';

import ui from './ui.module.css';

interface TextFieldProps {
  label: string;
  name: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  defaultValue?: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

/** A labelled input with its hint and validation message wired for screen readers. */
export function TextField({
  label,
  name,
  type = 'text',
  autoComplete,
  defaultValue,
  hint,
  error,
  required = true,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={ui.field}>
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      <input
        className={ui.input}
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p className={ui.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={ui.fieldError} id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
