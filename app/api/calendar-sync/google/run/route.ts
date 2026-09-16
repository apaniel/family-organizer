import { NextRequest, NextResponse } from 'next/server';
import { requireCalendarSyncRouteAuth } from '@/lib/calendar-sync-auth';
import { runGoogleCalendarSync } from '@/lib/google-calendar/sync';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
    const auth = await requireCalendarSyncRouteAuth(request);
    if (!auth.authorized) return NextResponse.json({ error: 'Parent authorization required' }, { status: 401 });
    try {
        const result = await runGoogleCalendarSync();
        return NextResponse.json(result, { status: 'skipped' in result && result.skipped ? 409 : 200, headers: { 'Cache-Control': 'no-store' } });
    } catch { return NextResponse.json({ error: 'Google Calendar sync failed. Existing events were kept.' }, { status: 502 }); }
}
