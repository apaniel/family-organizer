'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CALENDAR_SYNC_PARENT_TOKEN_HEADER } from '@/lib/calendar-sync-constants';
import { getCachedToken } from '@/lib/instant-principal-storage';
export default function GoogleCalendarSyncSettings() {
    const [status, setStatus] = useState<any>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    function headers() { return { [CALENDAR_SYNC_PARENT_TOKEN_HEADER]: getCachedToken('parent') || '' }; }
    async function load() {
        try { const response = await fetch('/api/calendar-sync/google/status', { headers: headers() });
            if (!response.ok) throw new Error(); setStatus(await response.json()); }
        catch { setMessage('Activa el modo de padres para consultar el calendario.'); }
    }
    useEffect(() => { void load(); }, []);
    async function sync() {
        setBusy(true); setMessage('');
        try { const response = await fetch('/api/calendar-sync/google/run', { method: 'POST', headers: headers() });
            if (!response.ok) throw new Error(); setMessage('Calendario actualizado.'); await load(); }
        catch { setMessage('No se pudo actualizar. Los eventos existentes se conservan.'); }
        finally { setBusy(false); }
    }
    return <Card><CardHeader><CardTitle>Calendario familiar</CardTitle>
        <CardDescription>Google Calendar · losapalas@gmail.com</CardDescription></CardHeader>
        <CardContent className="space-y-3"><p>Se actualiza automáticamente cada 5 minutos. Modifica los eventos en Google Calendar.</p>
        {status && <p>{status.configured ? 'Conectado' : 'Pendiente de conexión'} · Última actualización: {status.lastSuccessfulSyncAt ? new Date(status.lastSuccessfulSyncAt).toLocaleString() : 'Pendiente'}</p>}
        {status?.lastErrorMessage && <p>No se pudo completar la última actualización.</p>}
        <Button onClick={sync} disabled={busy || !status?.configured}>{busy ? 'Actualizando…' : 'Actualizar ahora'}</Button>
        {message && <p role="status">{message}</p>}</CardContent></Card>;
}
