import { Transform } from 'class-transformer';

// C0 control characters except TAB (\x09), LF (\x0A) and CR (\x0D); also DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function sanitizeText(value: string, { multiline }: { multiline: boolean }): string {
  let out = value.normalize('NFC').replace(CONTROL_CHARS, '');
  if (!multiline) out = out.replace(/[\r\n\t]+/g, ' ');
  else out = out.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  return out.trim();
}

/**
 * Normalises user-supplied text: NFC, strips control characters, trims.
 * Content is stored as plain text; clients must render it as text (never as HTML).
 */
export function SanitizedText(options: { multiline?: boolean } = {}) {
  return Transform(({ value }) =>
    typeof value === 'string' ? sanitizeText(value, { multiline: options.multiline ?? false }) : value,
  );
}

/** Converts empty strings to null so optional profile fields can be cleared. */
export function EmptyToNull() {
  return Transform(({ value }) => (value === '' ? null : value));
}
