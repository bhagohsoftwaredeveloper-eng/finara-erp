'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, BookOpen, FileText, CreditCard, Receipt,
  Users, ClipboardList, Building2, ChevronDown, LogOut, Settings,
  Package, Landmark, Wallet, ShieldCheck,
  ShoppingCart, Banknote, BarChart3, Repeat,
} from 'lucide-react';
import { clearSession, getUser } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { auth as authApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState, useEffect } from 'react';

const NAV = [
  { label: 'Dashboard',         href: '/',              icon: LayoutDashboard },
  { label: 'Chart of Accounts', href: '/accounts',      icon: BookOpen },
  { label: 'General Ledger',    href: '/journal',       icon: FileText },
  {
    label: 'Accounts Payable', icon: CreditCard,
    children: [
      { label: 'Bills',    href: '/payable' },
      { label: 'Vendors',  href: '/payable/vendors' },
      { label: 'AP Aging', href: '/payable/aging' },
    ],
  },
  {
    label: 'Accounts Receivable', icon: Receipt,
    children: [
      { label: 'Invoices',   href: '/receivable' },
      { label: 'Customers',  href: '/receivable/customers' },
      { label: 'AR Aging',   href: '/receivable/aging' },
    ],
  },
  {
    label: 'Payroll', icon: Users,
    children: [
      { label: 'Employees',       href: '/payroll/employees' },
      { label: 'Pay Periods',     href: '/payroll/periods' },
      { label: 'Calculator',      href: '/payroll/calculator' },
    ],
  },
  {
    label: 'BIR Compliance', icon: ClipboardList,
    children: [
      { label: 'VAT Summary (2550)',   href: '/bir/vat' },
      { label: 'Withholding (1601-C)', href: '/bir/withholding' },
      { label: 'EWT Summary (1601-EQ)',href: '/bir/ewt' },
      { label: 'Alphalist',           href: '/bir/alphalist' },
      { label: 'RELIEF Export',       href: '/bir/relief' },
    ],
  },
  { label: 'Purchase Orders', icon: ShoppingCart, href: '/purchase-orders' },
  { label: 'Expense Vouchers', icon: Wallet, href: '/expenses' },
  {
    label: 'Remittances', icon: Landmark,
    children: [
      { label: 'Dashboard',    href: '/remittance' },
      { label: 'Gov\'t Records', href: '/remittance/records' },
      { label: 'Daily Report', href: '/remittance/daily' },
    ],
  },
  {
    label: 'Inventory', icon: Package,
    children: [
      { label: 'Stock on Hand',  href: '/inventory' },
      { label: 'Items',          href: '/inventory/items' },
      { label: 'Transactions',   href: '/inventory/transactions' },
      { label: 'Reports',        href: '/inventory/reports' },
    ],
  },
  { label: 'Fixed Assets',     icon: Building2, href: '/assets' },
  { label: 'Bank Reconciliation', icon: Banknote, href: '/bank' },
  { label: 'Budgeting',        icon: BarChart3, href: '/budget' },
  { label: 'Recurring Entries', icon: Repeat, href: '/recurring' },
  {
    label: 'Reports', icon: FileText,
    children: [
      { label: 'Trial Balance',    href: '/reports/trial-balance' },
      { label: 'Income Statement', href: '/reports/income-statement' },
      { label: 'Balance Sheet',    href: '/reports/balance-sheet' },
      { label: 'Custom Reports',   href: '/reports/custom' },
    ],
  },
  { label: 'Audit Trail', href: '/audit', icon: ShieldCheck, roles: ['ADMIN', 'MANAGER'] },
];

function NavItem({ item }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (item.children) {
    const isActive = item.children.some((c) => pathname.startsWith(c.href));
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={`sidebar-link w-full ${isActive ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          <item.icon className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open || isActive ? 'rotate-180' : ''}`} />
        </button>
        {(open || isActive) && (
          <div className="ml-7 mt-0.5 space-y-0.5">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                  pathname === child.href
                    ? 'text-blue-600 font-medium bg-blue-50'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = pathname === item.href;
  return (
    <Link href={item.href} className={isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
      <item.icon className="w-4 h-4 flex-shrink-0" />
      {item.label}
    </Link>
  );
}

export default function Sidebar() {
  const router = useRouter();
  // Read user from localStorage only after mount so the first client render
  // matches the server (which has no localStorage) — avoids hydration mismatch.
  const [user, setUser] = useState(null);
  useEffect(() => { setUser(getUser()); }, []);

  const handleLogout = async () => {
    try { await authApi.logout(); } catch {}
    clearSession();
    toast.success('Logged out');
    router.push('/login');
  };

  return (
    <aside className="flex flex-col w-64 bg-white border-r border-gray-200 h-screen fixed left-0 top-0 z-30 dark:bg-gray-900 dark:border-gray-800">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-200 flex items-center dark:border-gray-800">
        <img src="/finara-logo.svg" alt="Finara" className="h-10 w-auto block dark:hidden" />
        <img src="/finara-logo-white.svg" alt="Finara" className="h-10 w-auto hidden dark:block" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {NAV.filter((item) => !item.roles || item.roles.includes(user?.role)).map((item) => (
          <NavItem key={item.label} item={item} />
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-gray-200 p-3 space-y-1">
        <Link href="/settings" className="sidebar-link-inactive">
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold flex-shrink-0">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{user?.name || user?.email}</div>
            <div className="text-xs text-gray-400 truncate">{user?.role}</div>
          </div>
          <button onClick={handleLogout} className="text-gray-400 hover:text-red-500 transition-colors" title="Logout">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
