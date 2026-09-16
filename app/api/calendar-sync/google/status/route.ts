import { NextRequest, NextResponse } from 'next/server';
import { requireCalendarSyncRouteAuth } from '@/lib/calendar-sync-auth';
import { getGoogleCalendarStatus } from '@/lib/google-calendar/sync';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
    const auth = await requireCalendarSyncRouteAuth(request);
    if (!auth.authorized) return NextResponse.json({ error: 'Parent authorization required' }, { status: 401 });
    return NextResponse.json(await getGoogleCalendarStatus(), { headers: { 'Cache-Control': 'no-store' } });
}
