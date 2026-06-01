/**
 * Umami analytics — thin wrapper around window.umami.track().
 * Safe to call server-side (no-ops when window is undefined).
 */

declare global {
  interface Window {
    umami?: {
      track(event: string, data?: Record<string, string | number | boolean>): void
    }
  }
}

export function track(
  event: string,
  data?: Record<string, string | number | boolean>,
): void {
  if (typeof window !== 'undefined') {
    window.umami?.track(event, data)
  }
}
