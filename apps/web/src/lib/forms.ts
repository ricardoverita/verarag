/** A text field of a submitted form. Files and missing fields read as empty. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
