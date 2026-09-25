import localFont from 'next/font/local';
import type {Metadata,Viewport} from 'next';
import InstallAppPrompt from '@/components/mission/InstallAppPrompt';
import './globals.css';
const inter=localFont({src:'../public/fonts/Inter_18pt-Regular.ttf',display:'swap'});
export const metadata:Metadata={title:'Apalas · En familia',description:'El calendario, los planes y el día a día de nuestra familia.',manifest:'/manifest.json',icons:{icon:[{url:'/icon-192x192.png',sizes:'192x192',type:'image/png'},{url:'/icon-512x512.png',sizes:'512x512',type:'image/png'}],apple:'/icon-192x192.png'},appleWebApp:{capable:true,title:'Apalas',statusBarStyle:'black-translucent'}};
export const viewport:Viewport={width:'device-width',initialScale:1,maximumScale:5,userScalable:true,themeColor:'#17243b'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="es"><body className={inter.className}>{children}<InstallAppPrompt/></body></html>;
}
