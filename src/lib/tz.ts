/** The app's timezone: the user's local IANA zone, resolved once. */
export const TZ: string = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
})();
