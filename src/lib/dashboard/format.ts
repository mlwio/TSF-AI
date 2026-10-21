/**
 * Timestamps are rendered in a FIXED time zone on purpose.
 *
 * These components render once on the server (during SSR) and again in the
 * browser. `Intl` with the ambient time zone would produce a different string
 * on each side and React would report a hydration mismatch, so the zone is
 * pinned here instead. Change it if you are not operating from Dhaka.
 */
const DISPLAY_TIME_ZONE = 'Asia/Dhaka';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: DISPLAY_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  timeZone: DISPLAY_TIME_ZONE,
});

/** e.g. "14:32" */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** e.g. "18/10" */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}
