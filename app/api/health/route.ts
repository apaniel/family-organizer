import { NextResponse } from 'next/server';
import {getCloudflareContext} from '@opennextjs/cloudflare';

export const dynamic = 'force-dynamic';

export async function GET() {
    let version: string | null = null;
    try { const {env}=await getCloudflareContext({async:true});version=(env as any).WORKER_VERSION?.id||null; } catch {}
    return NextResponse.json(
        {
            ok: true,
            version,
            service: 'family-organizer',
            timestamp: new Date().toISOString(),
        },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
