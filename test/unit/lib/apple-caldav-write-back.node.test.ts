import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW_ISO = '2026-05-04T12:00:00.000Z';

const ACCOUNT = {
    id: 'account-1',
    provider: 'apple-caldav',
    status: 'active',
    username: 'parent@example.com',
    passwordCiphertext: 'ciphertext',
};

const WRITABLE_CALENDAR = {
    id: 'cal-row-1',
    accountId: 'account-1',
    remoteCalendarId: 'home',
    displayName: 'Home',
    remoteUrl: 'https://caldav.icloud.com/12345/calendars/home/',
    canWrite: true,
    isEnabled: true,
};

const READONLY_CALENDAR = {
    ...WRITABLE_CALENDAR,
    remoteCalendarId: 'holidays',
    displayName: 'Holidays',
    remoteUrl: 'https://caldav.icloud.com/12345/calendars/holidays/',
    canWrite: false,
};

const EXISTING_REMOTE_ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//iOS//EN',
    'BEGIN:VEVENT',
    'UID:event-1@icloud',
    'DTSTAMP:20260101T000000Z',
    'DTSTART:20260310T130000Z',
    'DTEND:20260310T140000Z',
    'SUMMARY:Old',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

function setupMocks(input: {
    item: any;
    accounts?: any[];
    calendars?: any[];
    fetchExisting?: { ics: string; etag: string };
    fetchExistingError?: Error;
    updateResult?: { etag: string };
    updateError?: Error;
    createResult?: { url: string; etag: string };
    createError?: Error;
    deleteResult?: { alreadyDeleted: boolean };
    deleteError?: Error;
}) {
    const transactSpy = vi.fn().mockResolvedValue(undefined);
    // db.tx.calendarItems[id].update(patch)
    //   ^   ^             ^    ^
    //   1   2             3    4
    const txProxy = new Proxy({}, {
        get: () => new Proxy({}, {
            get: () => new Proxy({}, {
                get: () => (patch: Record<string, any>) => ({ __op: 'update', patch }),
            }),
        }),
    });

    vi.doMock('@/lib/instant-admin', () => ({
        getInstantAdminDb: () => ({
            query: vi.fn(async () => ({ calendarItems: input.item ? [input.item] : [] })),
            transact: transactSpy,
            tx: txProxy,
        }),
    }));

    vi.doMock('@/lib/apple-caldav/repository', () => ({
        listCalendarSyncAccounts: vi.fn(async () => input.accounts ?? [ACCOUNT]),
        listCalendarSyncCalendars: vi.fn(async () => input.calendars ?? [WRITABLE_CALENDAR]),
    }));

    vi.doMock('@/lib/apple-caldav/crypto', () => ({
        decryptCalendarCredential: vi.fn(() => 'decrypted-password'),
    }));

    const fetchSpy = vi.fn(async () => {
        if (input.fetchExistingError) throw input.fetchExistingError;
        return input.fetchExisting ?? { ics: EXISTING_REMOTE_ICS, etag: '"etag-1"' };
    });
    const updateSpy = vi.fn(async () => {
        if (input.updateError) throw input.updateError;
        return input.updateResult ?? { etag: '"etag-2"' };
    });
    const createSpy = vi.fn(async () => {
        if (input.createError) throw input.createError;
        return input.createResult ?? {
            url: 'https://caldav.icloud.com/12345/calendars/home/created.ics',
            etag: '"new-etag"',
        };
    });
    const deleteSpy = vi.fn(async () => {
        if (input.deleteError) throw input.deleteError;
        return input.deleteResult ?? { alreadyDeleted: false };
    });

    vi.doMock('@/lib/apple-caldav/write-client', async () => {
        const actual = await vi.importActual<any>('@/lib/apple-caldav/write-client');
        return {
            ...actual,
            fetchAppleCalendarObject: fetchSpy,
            updateAppleCalendarObject: updateSpy,
            createAppleCalendarObject: createSpy,
            deleteAppleCalendarObject: deleteSpy,
        };
    });

    return { transactSpy, fetchSpy, updateSpy, createSpy, deleteSpy };
}

describe('apple-caldav write-back orchestration', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('@/lib/instant-admin');
        vi.doUnmock('@/lib/apple-caldav/repository');
        vi.doUnmock('@/lib/apple-caldav/crypto');
        vi.doUnmock('@/lib/apple-caldav/write-client');
        vi.unstubAllGlobals();
    });

    it('updates an existing Apple-sourced item: fetches current ICS, serializes, PUTs, persists new etag', async () => {
        const item = {
            id: 'item-1',
            uid: 'event-1@icloud',
            sourceType: 'apple-caldav',
            sourceCalendarId: 'home',
            sourceRemoteUrl: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            sourceRemoteEtag: '"etag-1"',
            title: 'Edited title',
            description: 'Edited notes',
            startDate: '2026-03-10T15:00:00.000Z',
            endDate: '2026-03-10T16:00:00.000Z',
            isAllDay: false,
            sequence: 2,
        };
        const mocks = setupMocks({ item });

        const { pushCalendarItemToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemToApple({ itemId: 'item-1', nowIso: NOW_ISO });

        expect(result).toEqual({
            status: 'synced',
            remoteUrl: item.sourceRemoteUrl,
            etag: '"etag-2"',
        });
        expect(mocks.fetchSpy).toHaveBeenCalledWith({
            username: ACCOUNT.username,
            password: 'decrypted-password',
            url: item.sourceRemoteUrl,
        });
        expect(mocks.updateSpy).toHaveBeenCalledTimes(1);
        const updateArgs = (mocks.updateSpy.mock.calls[0] as any[])[0] as any;
        expect(updateArgs.etag).toBe('"etag-1"');
        // Serialized ICS should preserve the alarm and use the new title:
        expect(updateArgs.ics).toContain('SUMMARY:Edited title');
        expect(updateArgs.ics).toContain('BEGIN:VALARM');
        expect(mocks.transactSpy).toHaveBeenCalledTimes(1);
    });

    it('creates a new Apple object when the item has no remote url, persisting URL/etag/sourceType', async () => {
        const item = {
            id: 'item-2',
            uid: '',
            sourceType: '',
            title: 'Brand new event',
            startDate: '2026-06-15T09:00:00.000Z',
            endDate: '2026-06-15T10:00:00.000Z',
            isAllDay: false,
        };
        const mocks = setupMocks({ item });

        const { pushCalendarItemToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemToApple({
            itemId: 'item-2',
            targetCalendarId: 'home',
            nowIso: NOW_ISO,
        });

        expect(result.status).toBe('synced');
        expect(mocks.fetchSpy).not.toHaveBeenCalled();
        expect(mocks.createSpy).toHaveBeenCalledTimes(1);
        const createArgs = (mocks.createSpy.mock.calls[0] as any[])[0] as any;
        expect(createArgs.calendarUrl).toBe(WRITABLE_CALENDAR.remoteUrl);
        expect(createArgs.uid).toMatch(/^family-organizer-item-2$/);
        expect(createArgs.ics).toContain('SUMMARY:Brand new event');
    });

    it('returns noop when the target calendar is read-only', async () => {
        const item = {
            id: 'item-3',
            sourceType: 'apple-caldav',
            sourceCalendarId: 'holidays',
            title: 'Holiday',
            startDate: '2026-12-25T00:00:00.000Z',
            endDate: '2026-12-26T00:00:00.000Z',
            isAllDay: true,
        };
        const mocks = setupMocks({ item, calendars: [READONLY_CALENDAR] });

        const { pushCalendarItemToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemToApple({ itemId: 'item-3', nowIso: NOW_ISO });

        expect(result).toEqual({ status: 'noop', reason: 'remote_readonly' });
        expect(mocks.updateSpy).not.toHaveBeenCalled();
        expect(mocks.createSpy).not.toHaveBeenCalled();
    });

    it('returns noop when no active Apple account exists', async () => {
        const item = { id: 'item-4', sourceType: 'apple-caldav', sourceCalendarId: 'home' };
        const mocks = setupMocks({ item, accounts: [] });

        const { pushCalendarItemToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemToApple({ itemId: 'item-4', nowIso: NOW_ISO });

        expect(result).toEqual({ status: 'noop', reason: 'account_inactive' });
        expect(mocks.updateSpy).not.toHaveBeenCalled();
    });

    it('returns conflict and persists remote-changed status when update hits an etag mismatch', async () => {
        const item = {
            id: 'item-5',
            uid: 'event-1@icloud',
            sourceType: 'apple-caldav',
            sourceCalendarId: 'home',
            sourceRemoteUrl: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            sourceRemoteEtag: '"stale"',
            title: 'Edited',
            startDate: '2026-03-10T15:00:00.000Z',
            endDate: '2026-03-10T16:00:00.000Z',
            isAllDay: false,
        };
        const { CalDAVETagMismatchError } = await import('@/lib/apple-caldav/write-client');
        const mocks = setupMocks({ item, updateError: new CalDAVETagMismatchError() });

        const { pushCalendarItemToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemToApple({ itemId: 'item-5', nowIso: NOW_ISO });

        expect(result).toEqual({ status: 'conflict', reason: 'remote_changed' });
        expect(mocks.transactSpy).toHaveBeenCalledTimes(1);
    });

    it('deletes an Apple-sourced item with If-Match and persists deleted-by-app status', async () => {
        const item = {
            id: 'item-6',
            sourceType: 'apple-caldav',
            sourceRemoteUrl: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            sourceRemoteEtag: '"etag-1"',
        };
        const mocks = setupMocks({ item });

        const { pushCalendarItemDeletionToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemDeletionToApple({ itemId: 'item-6', nowIso: NOW_ISO });

        expect(result).toEqual({ status: 'deleted' });
        expect(mocks.deleteSpy).toHaveBeenCalledWith({
            username: ACCOUNT.username,
            password: 'decrypted-password',
            url: item.sourceRemoteUrl,
            etag: '"etag-1"',
        });
        expect(mocks.transactSpy).toHaveBeenCalledTimes(1);
    });

    it('returns conflict when delete hits an etag mismatch', async () => {
        const item = {
            id: 'item-7',
            sourceType: 'apple-caldav',
            sourceRemoteUrl: 'https://caldav.icloud.com/12345/calendars/home/event-1.ics',
            sourceRemoteEtag: '"stale"',
        };
        const { CalDAVETagMismatchError } = await import('@/lib/apple-caldav/write-client');
        setupMocks({ item, deleteError: new CalDAVETagMismatchError() });

        const { pushCalendarItemDeletionToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemDeletionToApple({ itemId: 'item-7', nowIso: NOW_ISO });

        expect(result).toEqual({ status: 'conflict', reason: 'remote_changed' });
    });

    it('skips delete when the item is not Apple-sourced', async () => {
        const item = { id: 'item-8', sourceType: '' };
        const mocks = setupMocks({ item });

        const { pushCalendarItemDeletionToApple } = await import('@/lib/apple-caldav/write-back');
        const result = await pushCalendarItemDeletionToApple({ itemId: 'item-8', nowIso: NOW_ISO });

        expect(result).toEqual({ status: 'noop', reason: 'not_apple_sourced' });
        expect(mocks.deleteSpy).not.toHaveBeenCalled();
    });
});
