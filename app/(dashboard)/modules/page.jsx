import { redirect } from 'next/navigation';

// Now a tab inside Settings; keep the old URL working.
export default function Page() {
  redirect('/settings?tab=modules');
}
