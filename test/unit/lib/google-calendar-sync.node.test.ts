import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/apple-caldav/repository', () => ({
    acquireCalendarSyncLock: vi.fn(), releaseCalendarSyncLock: vi.fn(), upsertCalendarSyncAccount: vi.fn(),
    upsertImportedCalendarItems: vi.fn(), listCalendarSyncAccounts: vi.fn(),
}));
import * as repo from '@/lib/apple-caldav/repository';
import { validateGoogleCalendarFeed, parseGoogleCalendarFeed, runGoogleCalendarSync } from '@/lib/google-calendar/sync';
const url = 'https://calendar.google.com/calendar/ical/losapalas%40gmail.com/private-abcdef123/basic.ics';
const ics = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:family-test','DTSTART;VALUE=DATE:20260916','DTEND;VALUE=DATE:20260917','SUMMARY:Family day','RRULE:FREQ=WEEKLY;COUNT=3','END:VEVENT','BEGIN:VEVENT','UID:family-test','RECURRENCE-ID;VALUE=DATE:20260923','DTSTART;VALUE=DATE:20260924','DTEND;VALUE=DATE:20260925','SUMMARY:Moved day','END:VEVENT','END:VCALENDAR',''].join('\r\n');
beforeEach(() => {
    process.env.GOOGLE_CALENDAR_ICS_URL = url;
    vi.mocked(repo.acquireCalendarSyncLock).mockResolvedValue({ acquired: true, lockId: 'lock' });
    vi.mocked(repo.listCalendarSyncAccounts).mockResolvedValue([]);
    vi.mocked(repo.upsertCalendarSyncAccount).mockResolvedValue('account');
    vi.mocked(repo.upsertImportedCalendarItems).mockResolvedValue({ eventsCreated: 0 } as any);
});
describe('private Google calendar import', () => {
    it('accepts only the intended private Google feed', () => {
        expect(validateGoogleCalendarFeed(url).hostname).toBe('calendar.google.com');
        for (const bad of [url.replace('https:', 'http:'), url.replace('calendar.google.com', 'evil.test'), url.replace('losapalas', 'other'), url.replace('private-abcdef123','public'), url+'?token=secret', 'not a url']) {
            expect(() => validateGoogleCalendarFeed(bad)).toThrow();
        }
    });
    it('preserves all-day recurrence and exception links, stable IDs, and excludes subscription secrets', () => {
        const events = parseGoogleCalendarFeed(ics);
        expect(events).toHaveLength(2);
        expect(events[0].sourceType).toBe('google-calendar');
        expect(events[0].rrule).toContain('FREQ=WEEKLY');
        expect(events[1].recurringEventId).toBe(events[0].sourceExternalId);
        expect(events[0].uid).toBe(events[0].sourceExternalId);
        expect(events[0].sourceReadOnly).toBe(true);
        expect(events.map(e=>e.sourceExternalId)).toEqual(parseGoogleCalendarFeed(ics).map(e=>e.sourceExternalId));
        expect(JSON.stringify(events)).not.toContain('private-');
    });
    it('never reconciles existing events after a failed fetch', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(url)));
        await expect(runGoogleCalendarSync()).rejects.toThrow('Could not fetch');
        expect(repo.upsertImportedCalendarItems).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(repo.upsertCalendarSyncAccount).mock.calls)).not.toContain('private-');
        expect(repo.releaseCalendarSyncLock).toHaveBeenCalledWith('lock');
    });
    it('rejects redirects without forwarding the private URL to another host', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {status:302, headers:{Location:'https://other.test/'}})));
        await expect(runGoogleCalendarSync()).rejects.toThrow('HTTP 302');
        expect(repo.upsertImportedCalendarItems).not.toHaveBeenCalled();
    });
    it('rejects malformed successful responses without deleting events', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>error</html>')));
        await expect(runGoogleCalendarSync()).rejects.toThrow('Invalid Google Calendar feed');
        expect(repo.upsertImportedCalendarItems).not.toHaveBeenCalled();
    });
    it('imports a complete feed read-only with soft deletions scoped to Google', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(ics)); vi.stubGlobal('fetch',fetcher);
        await runGoogleCalendarSync();
        expect(fetcher.mock.calls[0][1]).toMatchObject({redirect:'manual',cache:'no-store'});
        expect(repo.upsertImportedCalendarItems).toHaveBeenCalledWith(expect.objectContaining({accountId:'account',calendarId:'losapalas@gmail.com',hardDeleteMissingRows:false,historySource:'google_sync'}));
    });
});
