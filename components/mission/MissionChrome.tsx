'use client';
import {usePathname} from 'next/navigation';
import {ThemedMain} from '@/components/ThemedAppShell';
export function LegacyChrome({children}:{children:React.ReactNode}) {return ['/', '/family-calendar','/week'].includes(usePathname())?null:<>{children}</>;}
export function MissionMain({children}:{children:React.ReactNode}) {return ['/', '/family-calendar','/week'].includes(usePathname())?<main className="flex-1">{children}</main>:<ThemedMain>{children}</ThemedMain>;}
