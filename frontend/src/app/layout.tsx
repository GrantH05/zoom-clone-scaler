import './globals.css';
import DefaultAccount from '@/components/DefaultAccount';
import type { Metadata } from 'next';
export const metadata: Metadata = { title:'Zoom Clone', description:'Full-stack Zoom-style video conferencing platform' };
export default function RootLayout({children}:{children:React.ReactNode}){ return <html lang="en"><body><DefaultAccount>{children}</DefaultAccount></body></html> }
