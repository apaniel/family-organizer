import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SAMPLE_ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Organizer//EN',
    'BEGIN:VEVENT',
    'UID:event-1@family-organizer',
    'DTSTAMP:20260101T120000Z',
    'DTSTART:20260310T120000Z',
    'DTEND:20260310T130000Z',
    'SUMMARY:Test',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

describe('apple-caldav write client', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('PUTs new events with If-None-Match: * and returns the new etag', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response('', { status: 201, headers: { etag: '"new-etag"' } })
        );
        vi.stubGlobal('fetch', fetchMock);

        const { createAppleCalendarObject } = await import('@/lib/apple-caldav/write-client');
        const result = await createAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            calendarUrl: 'https://caldav.icloud.com/12345/calendars/home',
            ics: SAMPLE_ICS,
            uid: 'event-1',
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [calledUrl, calledInit] = fetchMock.mock.calls[0];
        expect(calledUrl).toBe('https://caldav.icloud.com/12345/calendars/home/event-1.ics');
        expect(calledInit?.method).toBe('PUT');
        expect(calledInit?.headers?.['If-None-Match']).toBe('*');
        expect(calledInit?.headers?.Authorization).toMatch(/^Basic /);
        expect(calledInit?.headers?.['content-type']).toContain('text/calendar');
        expect(calledInit?.body).toBe(SAMPLE_ICS);
        expect(result.url).toBe('https://caldav.icloud.com/12345/calendars/home/event-1.ics');
        expect(result.etag).toBe('"new-etag"');
    });

    it('throws CalDAVUidConflictError when create returns 412 (UID already exists)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 412 })));

        const { createAppleCalendarObject, CalDAVUidConflictError } = await import('@/lib/apple-caldav/write-client');
        await expect(createAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            calendarUrl: 'https://caldav.icloud.com/12345/calendars/home/',
            ics: SAMPLE_ICS,
            uid: 'event-1',
        })).rejects.toBeInstanceOf(CalDAVUidConflictError);
    });

    it('PUTs updates with If-Match and returns the new etag', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response(null, { status: 204, headers: { etag: '"etag-2"' } })
        );
        vi.stubGlobal('fetch', fetchMock);

        const { updateAppleCalendarObject } = await import('@/lib/apple-caldav/write-client');
        const result = await updateAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            url: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            ics: SAMPLE_ICS,
            etag: '"etag-1"',
        });

        const [calledUrl, calledInit] = fetchMock.mock.calls[0];
        expect(calledUrl).toBe('https://caldav.icloud.com/12345/calendars/home/event-1.ics');
        expect(calledInit?.method).toBe('PUT');
        expect(calledInit?.headers?.['If-Match']).toBe('"etag-1"');
        expect(calledInit?.body).toBe(SAMPLE_ICS);
        expect(result.etag).toBe('"etag-2"');
    });

    it('throws CalDAVETagMismatchError when update returns 412', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 412 })));

        const { updateAppleCalendarObject, CalDAVETagMismatchError } = await import('@/lib/apple-caldav/write-client');
        await expect(updateAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            url: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            ics: SAMPLE_ICS,
            etag: '"stale"',
        })).rejects.toBeInstanceOf(CalDAVETagMismatchError);
    });

    it('throws CalDAVNotFoundError when update returns 404', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 404 })));

        const { updateAppleCalendarObject, CalDAVNotFoundError } = await import('@/lib/apple-caldav/write-client');
        await expect(updateAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            url: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            ics: SAMPLE_ICS,
            etag: '"etag-1"',
        })).rejects.toBeInstanceOf(CalDAVNotFoundError);
    });

    it('refuses updates without an etag (forces conflict-aware writes)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const { updateAppleCalendarObject } = await import('@/lib/apple-caldav/write-client');
        await expect(updateAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            url: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            ics: SAMPLE_ICS,
            etag: '',
        })).rejects.toThrow(/non-empty etag/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('DELETEs with If-Match and treats 404 as already-deleted', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 404 }));
        vi.stubGlobal('fetch', fetchMock);

        const { deleteAppleCalendarObject } = await import('@/lib/apple-caldav/write-client');
        const result = await deleteAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            url: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            etag: '"etag-1"',
        });

        const [, calledInit] = fetchMock.mock.calls[0];
        expect(calledInit?.method).toBe('DELETE');
        expect(calledInit?.headers?.['If-Match']).toBe('"etag-1"');
        expect(result.alreadyDeleted).toBe(true);
    });

    it('throws CalDAVETagMismatchError when delete returns 412', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 412 })));

        const { deleteAppleCalendarObject, CalDAVETagMismatchError } = await import('@/lib/apple-caldav/write-client');
        await expect(deleteAppleCalendarObject({
            username: 'parent@example.com',
            password: 'app-password',
            url: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            etag: '"stale"',
        })).rejects.toBeInstanceOf(CalDAVETagMismatchError);
    });
});
