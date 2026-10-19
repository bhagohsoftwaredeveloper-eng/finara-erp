'use client';
import { usePathname } from 'next/navigation';
import { formatDate } from '@/lib/auth';
import { useBusiness } from '@/lib/businessContext';
import { Menu, LogOut, ShieldAlert } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import GlobalSearch from './GlobalSearch';
import BusinessSwitcher from './BusinessSwitcher';
import NotificationBell from './NotificationBell';

const TITLE_MAP = {
  '/': 'Dashboard',
  '/accounts': 'Chart of Accounts',
  '/journal': 'General Ledger / Journal',
  '/payable': 'Accounts Payable – Bills',
  '/payable/vendors': 'Vendors',
  '/payable/aging': 'AP Aging Report',
  '/receivable': 'Accounts Receivable – Invoices',
  '/receivable/customers': 'Customers',
  '/receivable/aging': 'AR Aging Report',
  '/payroll/employees': 'Employees',
  '/payroll/periods': 'Payroll Periods',
  '/payroll/calculator': 'Payroll Calculator',
  '/bir/vat': 'VAT Summary (Form 2550)',
  '/bir/withholding': 'Withholding Tax (Form 1601-C)',
  '/bir/ewt': 'EWT Summary (Form 1601-EQ)',
  '/bir/alphalist': 'Alphalist of Employees',
  '/bir/relief': 'BIR RELIEF Export',
  '/reports/trial-balance': 'Trial Balance',
  '/reports/income-statement': 'Income Statement',
  '/reports/balance-sheet': 'Balance Sheet',
  '/purchase-orders': 'Purchase Orders',
  '/assets': 'Fixed Assets',
  '/bank': 'Bank Reconciliation',
  '/budget': 'Budgeting',
  '/recurring': 'Recurring Entries',
  '/audit': 'Audit Trail',
};

export default function Header({ onMobileMenu }) {
  const pathname = usePathname();
  const title = TITLE_MAP[pathname] || 'Finara ERP';
  const today = formatDate(new Date());

  return (
    <header className="h-14 lg:h-16 bg-white border-b border-gray-200 flex items-center px-3 lg:px-6 gap-2 lg:gap-4 sticky top-0 z-20 dark:bg-gray-900 dark:border-gray-800">
      {/* Hamburger — mobile only */}
      <button
        onClick={onMobileMenu}
        className="lg:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors dark:hover:text-gray-100 dark:hover:bg-gray-800"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      <div className="flex-1 min-w-0">
        <h1 className="text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">{today}</p>
      </div>

      <GlobalSearch />

      <BusinessSwitcher />

      <ThemeToggle />

      <NotificationBell />
    </header>
  );
}

// Amber banner shown across the top of the page while a SUPER_ADMIN is
// switched into an external (client-owned) business's context to configure its
// settings — so it is always obvious whose books you are working in.
export function ManageModeBanner() {
  const { businesses, activeBusiness, setActive } = useBusiness();

  if (!activeBusiness?.managed) return null;

  // Exit = switch back to the operator's first own (non-managed) business.
  const own = businesses.find((b) => !b.managed);
  const exit = () => { if (own && own.id !== activeBusiness.id) setActive(own.id); };

  return (
    <div className="flex flex-wrap items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-900/50 px-4 lg:px-6 py-2.5">
      <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
      <p className="text-sm text-amber-800 dark:text-amber-200 flex-1 min-w-0">
        <span className="font-semibold">Manage mode</span> — you are working inside{' '}
        <span className="font-semibold">{activeBusiness.name}</span> (external business).
        Changes here (modules, settings, permissions) apply to <em>their</em> books, not yours.
      </p>
      <button
        onClick={exit}
        disabled={!own}
        className="btn-secondary py-1.5 px-3 text-xs flex items-center gap-1.5 disabled:opacity-50"
      >
        <LogOut className="w-3.5 h-3.5" /> Exit Manage Mode
      </button>
    </div>
  );
}
