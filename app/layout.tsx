import localFont from 'next/font/local';
import type {Metadata,Viewport} from 'next';
import './globals.css';
const inter=localFont({src:'../public/fonts/Inter_18pt-Regular.ttf',display:'swap'});
export const metadata:Metadata={title:'Apalas · En familia',description:'El calendario, los planes y el día a día de nuestra familia.'};
export const viewport:Viewport={width:'device-width',initialScale:1,maximumScale:5,userScalable:true};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="es"><body className={inter.className}>{children}</body></html>;
}
