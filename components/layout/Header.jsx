'use client';
import { usePathname } from 'next/navigation';
import { Bell, Search } from 'lucide-react';
import { formatDate } from '@/lib/auth';

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
};

export default function Header() {
  const pathname = usePathname();
  const title = TITLE_MAP[pathname] || 'PH-ERP';
  const today = formatDate(new Date());

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 gap-4 sticky top-0 z-20">
      <div className="flex-1">
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        <p className="text-xs text-gray-400">{today}</p>
      </div>

      <div className="relative hidden md:block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Quick search..."
          className="pl-9 pr-4 py-2 bg-gray-100 border-0 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
        />
      </div>

      <button className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
        <Bell className="w-5 h-5" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
      </button>
    </header>
  );
}
