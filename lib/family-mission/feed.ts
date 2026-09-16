export const GOOGLE_CALENDAR_ID = 'losapalas@gmail.com';
export function validateGoogleCalendarFeed(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Google Calendar private feed is not configured'); }
    if (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' || url.port || url.username || url.password ||
        !new RegExp('^/calendar/ical/' + encodeURIComponent(GOOGLE_CALENDAR_ID) + '/private-[a-f0-9]+/basic\\.ics$', 'i').test(url.pathname) || url.search || url.hash) {
        throw new Error('Expected the private Google Calendar feed for losapalas@gmail.com');
    }
    return url;
}
