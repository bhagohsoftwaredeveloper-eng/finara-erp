'use client';
import { usePathname } from 'next/navigation';
import { formatDate } from '@/lib/auth';
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

export default function Header() {
  const pathname = usePathname();
  const title = TITLE_MAP[pathname] || 'PH-ERP';
  const today = formatDate(new Date());

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 gap-4 sticky top-0 z-20 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
        <p className="text-xs text-gray-400 dark:text-gray-500">{today}</p>
      </div>

      <GlobalSearch />

      <BusinessSwitcher />

      <ThemeToggle />

      <NotificationBell />
    </header>
  );
}
