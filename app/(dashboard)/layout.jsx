'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import toast from 'react-hot-toast';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import PageTransition from '@/components/layout/PageTransition';
import { isAuthenticated, getUser } from '@/lib/auth';
import { canAccess, canWrite, setPermissions } from '@/lib/permissions';
import { permissions as permApi } from '@/lib/api';
import { BusinessProvider } from '@/lib/businessContext';

export default function DashboardLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  // isAuthenticated() reads localStorage, which is unavailable during SSR.
  // Render nothing until mounted so the server and first client render match
  // (avoids a hydration mismatch), then redirect or show the layout.
  const [authed, setAuthed] = useState(null); // null = not yet determined
  const [collapsed, setCollapsed] = useState(false);
  const [readonly, setReadonly] = useState(false);
  const [permReady, setPermReady] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthed(true);
    } else {
      setAuthed(false);
      router.push('/login');
    }
  }, [router]);

  useEffect(() => { setCollapsed(localStorage.getItem('sidebarCollapsed') === '1'); }, []);
  useEffect(() => { if (authed) setReadonly(!canWrite(getUser()?.role)); }, [authed]);

  // Load this business's custom role permissions before enforcing the guard.
  useEffect(() => {
    if (!authed) return;
    permApi.get()
      .then(({ data }) => setPermissions(data))
      .catch(() => setPermissions(null)) // fall back to built-in defaults
      .finally(() => setPermReady(true));
  }, [authed]);

  // Role-based page guard: redirect away from routes the user can't access
  // (the Sidebar hides them, but a direct URL must be blocked too).
  useEffect(() => {
    if (!authed || !permReady) return;
    const role = getUser()?.role;
    if (!canAccess(pathname, role)) {
      toast.error('You do not have access to that page');
      router.replace('/');
    }
  }, [authed, permReady, pathname, router]);

  const toggleSidebar = () =>
    setCollapsed((c) => { const n = !c; localStorage.setItem('sidebarCollapsed', n ? '1' : '0'); return n; });

  if (!authed) return null;

  return (
    <BusinessProvider>
      <div className="flex h-screen bg-gray-50 dark:bg-gray-950" data-readonly={readonly}>
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} />
        <div className={`flex-1 flex flex-col ${collapsed ? 'ml-16' : 'ml-64'} min-h-screen overflow-hidden transition-all duration-200`}>
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            <PageTransition>
              {children}
            </PageTransition>
          </main>
        </div>
      </div>
    </BusinessProvider>
  );
}
