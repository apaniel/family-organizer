import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const pushCalendarItemToApple = vi.fn();
const pushCalendarItemDeletionToApple = vi.fn();

vi.mock('@/lib/apple-caldav/write-back', () => ({
    pushCalendarItemToApple,
    pushCalendarItemDeletionToApple,
}));

function buildRequest(body: any, headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost:3000/api/calendar-sync/apple/push', {
        method: 'POST',
        headers: {
            authorization: 'Bearer cron-secret',
            'content-type': 'application/json',
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

describe('POST /api/calendar-sync/apple/push', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        process.env.CALENDAR_SYNC_CRON_SECRET = 'cron-secret';
        pushCalendarItemToApple.mockReset();
        pushCalendarItemDeletionToApple.mockReset();
    });

    it('rejects requests without auth', async () => {
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(
            new NextRequest('http://localhost:3000/api/calendar-sync/apple/push', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ itemId: 'item-1', op: 'upsert' }),
            })
        );

        expect(response.status).toBe(401);
        expect(pushCalendarItemToApple).not.toHaveBeenCalled();
    });

    it('returns 400 when itemId is missing', async () => {
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ op: 'upsert' }));

        expect(response.status).toBe(400);
        expect(pushCalendarItemToApple).not.toHaveBeenCalled();
    });

    it('returns 400 for unsupported op values', async () => {
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ itemId: 'item-1', op: 'merge' }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining('Unsupported op') });
    });

    it('routes upsert to pushCalendarItemToApple and returns 200 on synced', async () => {
        pushCalendarItemToApple.mockResolvedValue({
            status: 'synced',
            remoteUrl: 'https://caldav.icloud.com/12345/calendars/home/item-1.ics',
            etag: '"etag-2"',
        });
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({
            itemId: 'item-1',
            op: 'upsert',
            targetCalendarId: 'home',
        }));

        expect(response.status).toBe(200);
        expect(pushCalendarItemToApple).toHaveBeenCalledWith({
            itemId: 'item-1',
            targetCalendarId: 'home',
        });
        expect(pushCalendarItemDeletionToApple).not.toHaveBeenCalled();
    });

    it('returns 409 when the orchestration reports a conflict', async () => {
        pushCalendarItemToApple.mockResolvedValue({
            status: 'conflict',
            reason: 'remote_changed',
        });
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ itemId: 'item-1', op: 'upsert' }));

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ status: 'conflict', reason: 'remote_changed' });
    });

    it('routes delete to pushCalendarItemDeletionToApple', async () => {
        pushCalendarItemDeletionToApple.mockResolvedValue({ status: 'deleted' });
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ itemId: 'item-1', op: 'delete' }));

        expect(response.status).toBe(200);
        expect(pushCalendarItemDeletionToApple).toHaveBeenCalledWith({ itemId: 'item-1' });
        expect(pushCalendarItemToApple).not.toHaveBeenCalled();
    });

    it('returns 409 when delete reports a conflict', async () => {
        pushCalendarItemDeletionToApple.mockResolvedValue({
            status: 'conflict',
            reason: 'remote_changed',
        });
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ itemId: 'item-1', op: 'delete' }));

        expect(response.status).toBe(409);
    });

    it('returns 500 when the orchestration throws an unexpected error', async () => {
        pushCalendarItemToApple.mockRejectedValue(new Error('CalDAV unavailable'));
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ itemId: 'item-1', op: 'upsert' }));

        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: 'CalDAV unavailable' });
    });

    it('defaults op to upsert when omitted', async () => {
        pushCalendarItemToApple.mockResolvedValue({
            status: 'synced',
            remoteUrl: 'https://caldav.icloud.com/12345/calendars/home/item-1.ics',
            etag: '"etag"',
        });
        const { POST } = await import('@/app/api/calendar-sync/apple/push/route');
        const response = await POST(buildRequest({ itemId: 'item-1' }));

        expect(response.status).toBe(200);
        expect(pushCalendarItemToApple).toHaveBeenCalled();
    });
});
