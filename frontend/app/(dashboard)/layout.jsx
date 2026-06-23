'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { isAuthenticated } from '@/lib/auth';

export default function DashboardLayout({ children }) {
  const router = useRouter();
  // isAuthenticated() reads localStorage, which is unavailable during SSR.
  // Render nothing until mounted so the server and first client render match
  // (avoids a hydration mismatch), then redirect or show the layout.
  const [authed, setAuthed] = useState(null); // null = not yet determined

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
    } else {
      setAuthed(false);
      router.push('/login');
    }
  }, [router]);

  if (!authed) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-64 min-h-screen overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
