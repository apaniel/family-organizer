import 'server-only';
import { parseCalendarResource } from '@/lib/apple-caldav/ics';
import { buildInstantCalendarItemPayload } from '@/lib/apple-caldav/mapper';
import { acquireCalendarSyncLock, releaseCalendarSyncLock, upsertCalendarSyncAccount, upsertImportedCalendarItems, listCalendarSyncAccounts } from '@/lib/apple-caldav/repository';

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
export function parseGoogleCalendarFeed(ics: string) {
    if (!/^BEGIN:VCALENDAR\r?\n/.test(ics.trim()) || !/END:VCALENDAR\s*$/.test(ics)) throw new Error('Invalid Google Calendar response');
    const events = parseCalendarResource({ accountId: 'google-losapalas', calendarId: GOOGLE_CALENDAR_ID,
        calendarName: 'Familia · Google Calendar', href: 'google-calendar://' + GOOGLE_CALENDAR_ID,
        etag: '', ics, rangeStart: new Date('1900-01-01'), rangeEnd: new Date('2200-01-01'), fallbackTimeZone: 'Europe/Madrid' });
    return events.map(event => ({ ...event, sourceType: 'google-calendar', uid: event.uid.replace(/^apple:/, 'google:'),
        sourceExternalId: event.sourceExternalId.replace(/^apple:/, 'google:'),
        recurringEventId: event.recurringEventId.replace(/^apple:/, 'google:') }));
}
export async function runGoogleCalendarSync() {
    const url = validateGoogleCalendarFeed(process.env.GOOGLE_CALENDAR_ICS_URL || '');
    const lock = await acquireCalendarSyncLock('google-losapalas', crypto.randomUUID(), new Date(Date.now() + 120000).toISOString());
    if (!lock.acquired) return { skipped: true, reason: 'already_running' };
    let accountId: string | undefined;
    try {
        const nowIso = new Date().toISOString();
        const existing = ((await listCalendarSyncAccounts()) as any[]).find((a: any) => a.provider === 'google-calendar');
        accountId = await upsertCalendarSyncAccount({ createdAt: existing?.createdAt || nowIso, updatedAt: nowIso, status: existing?.status || 'pending', passwordCiphertext: '', passwordKeyVersion: '', provider: 'google-calendar', username: GOOGLE_CALENDAR_ID,
            accountLabel: 'Familia · Google Calendar', lastAttemptedSyncAt: nowIso });
        let response: Response;
        try { response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) }); }
        catch { throw new Error('Could not fetch Google Calendar. Existing events were kept.'); }
        if (!response.ok) throw new Error('Google Calendar returned HTTP ' + response.status + '. Existing events were kept.');
        const text = await response.text();
        if (text.length > 10000000) throw new Error('Calendar feed is too large');
        let normalized;
        try { normalized = parseGoogleCalendarFeed(text); } catch { throw new Error('Invalid Google Calendar feed. Existing events were kept.'); }
        const items = normalized.map(event => buildInstantCalendarItemPayload({ ...event, sourceAccountKey: accountId }, nowIso));
        const counts = await upsertImportedCalendarItems({ accountId, calendarId: GOOGLE_CALENDAR_ID,
            calendarName: 'Familia · Google Calendar', items, seenSourceExternalIds: new Set(items.map(e => e.sourceExternalId)),
            nowIso, rangeStart: new Date('1900-01-01'), rangeEnd: new Date('2200-01-01'), historySource: 'google_sync', hardDeleteMissingRows: false });
        await upsertCalendarSyncAccount({ id: accountId, status: 'connected', lastSuccessfulSyncAt: nowIso, lastErrorMessage: '' });
        return { provider: 'google-calendar', calendar: GOOGLE_CALENDAR_ID, events: items.length, ...counts };
    } catch (error) {
        // Never persist upstream exception text: it can contain the private subscription URL.
        if (accountId) await upsertCalendarSyncAccount({ id: accountId, status: 'error', lastErrorAt: new Date().toISOString(), lastErrorMessage: 'Google Calendar sync failed; existing events were kept.' });
        throw error;
    } finally { await releaseCalendarSyncLock(lock.lockId); }
}
export async function getGoogleCalendarStatus() {
    const account = ((await listCalendarSyncAccounts()) as any[]).find((a: any) => a.provider === 'google-calendar');
    return { configured: Boolean(process.env.GOOGLE_CALENDAR_ICS_URL), calendar: GOOGLE_CALENDAR_ID,
        lastSuccessfulSyncAt: account?.lastSuccessfulSyncAt || null, lastErrorMessage: account?.lastErrorMessage || null };
}
