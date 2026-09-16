import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

vi.mock('@/lib/cloudflare-family-access', () => ({ isVerifiedFamilyParent: vi.fn(async () => false) }));
import { isVerifiedFamilyParent } from '@/lib/cloudflare-family-access';

describe('middleware device auth gate', () => {
    beforeEach(() => {
        vi.mocked(isVerifiedFamilyParent).mockResolvedValue(false);
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        (process.env as any).NODE_ENV = 'test';
    });

    it('activates the device after verified Cloudflare parent login', async () => {
        vi.mocked(isVerifiedFamilyParent).mockResolvedValue(true);
        const response = await middleware(new NextRequest('https://apalas.apaniel.dev/', {headers:{'cf-access-jwt-assertion':'verified-by-helper'}}));
        expect(response.headers.get('x-middleware-next')).toBe('1');
        expect(response.headers.get('set-cookie')).toContain('family_device_auth=true');
    });

    it('returns 401 JSON for unauthorized API requests', async () => {
        const response = await middleware(new NextRequest('http://localhost:3000/api/instant-auth-token'));
        expect(response.status).toBe(401);
        expect(await response.text()).toContain('Unauthorized Device');
    });

    it('returns hard 404 for unauthorized page requests', async () => {
        const response = await middleware(new NextRequest('http://localhost:3000/'));
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not Found');
    });

    it('activates device auth via the magic link and sets the cookie', async () => {
        const response = await middleware(new NextRequest('http://localhost:3000/?activate=test-device-key'));
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toMatch(/\/$/);
        expect(response.headers.get('set-cookie')).toContain('family_device_auth=true');
    });

    it('passes through when the device auth cookie is present', async () => {
        const response = await middleware(
            new NextRequest('http://localhost:3000/', {
                headers: { cookie: 'family_device_auth=true' },
            })
        );

        expect(response.headers.get('x-middleware-next')).toBe('1');
    });

    it('allows offline shell and manifest assets without device auth', async () => {
        const manifestResponse = await middleware(new NextRequest('http://localhost:3000/manifest.json'));
        const offlineResponse = await middleware(new NextRequest('http://localhost:3000/offline.html'));
        const activateResponse = await middleware(new NextRequest('http://localhost:3000/activate'));
        const deviceActivateApiResponse = await middleware(new NextRequest('http://localhost:3000/api/device-activate'));
        const mobileApiResponse = await middleware(new NextRequest('http://localhost:3000/api/mobile/device-activate'));
        const calendarSyncRunResponse = await middleware(new NextRequest('http://localhost:3000/api/calendar-sync/apple/run'));

        expect(manifestResponse.headers.get('x-middleware-next')).toBe('1');
        expect(offlineResponse.headers.get('x-middleware-next')).toBe('1');
        expect(activateResponse.headers.get('x-middleware-next')).toBe('1');
        expect(deviceActivateApiResponse.headers.get('x-middleware-next')).toBe('1');
        expect(mobileApiResponse.headers.get('x-middleware-next')).toBe('1');
        expect(calendarSyncRunResponse.headers.get('x-middleware-next')).toBe('1');
    });

    it('blocks legacy upload and delete-image routes without device auth', async () => {
        const uploadApiResponse = await middleware(new NextRequest('http://localhost:3000/api/upload'));
        const deleteImageApiResponse = await middleware(new NextRequest('http://localhost:3000/api/delete-image'));

        expect(uploadApiResponse.status).toBe(401);
        expect(await uploadApiResponse.text()).toContain('Unauthorized Device');
        expect(deleteImageApiResponse.status).toBe(401);
        expect(await deleteImageApiResponse.text()).toContain('Unauthorized Device');
    });
});
