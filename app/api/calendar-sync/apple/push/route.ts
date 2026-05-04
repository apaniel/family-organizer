import { NextRequest, NextResponse } from 'next/server';
import { getCalendarSyncAuthError, requireCalendarSyncRouteAuth } from '@/lib/calendar-sync-auth';
import { pushCalendarItemToApple, pushCalendarItemDeletionToApple } from '@/lib/apple-caldav/write-back';

export const dynamic = 'force-dynamic';

type PushBody = {
    itemId?: unknown;
    op?: unknown;
    targetCalendarId?: unknown;
};

export async function POST(request: NextRequest) {
    const auth = await requireCalendarSyncRouteAuth(request);
    if (!auth.authorized) {
        return NextResponse.json(
            { ...getCalendarSyncAuthError(auth.reason), reason: auth.reason },
            { status: 401 }
        );
    }

    let body: PushBody = {};
    try {
        body = (await request.json()) as PushBody;
    } catch {
        body = {};
    }

    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    if (!itemId) {
        return NextResponse.json({ error: 'itemId is required' }, { status: 400 });
    }

    const op = typeof body.op === 'string' ? body.op : 'upsert';
    if (op !== 'upsert' && op !== 'delete') {
        return NextResponse.json({ error: `Unsupported op "${op}"` }, { status: 400 });
    }

    try {
        if (op === 'delete') {
            const result = await pushCalendarItemDeletionToApple({ itemId });
            const status = result.status === 'conflict' ? 409 : 200;
            return NextResponse.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
        }

        const targetCalendarId = typeof body.targetCalendarId === 'string' && body.targetCalendarId.trim()
            ? body.targetCalendarId.trim()
            : undefined;
        const result = await pushCalendarItemToApple({ itemId, targetCalendarId });
        const status = result.status === 'conflict' ? 409 : 200;
        return NextResponse.json(result, { status, headers: { 'Cache-Control': 'no-store' } });
    } catch (error: any) {
        return NextResponse.json(
            { error: error?.message || 'Failed to push calendar item to Apple' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } }
        );
    }
}
