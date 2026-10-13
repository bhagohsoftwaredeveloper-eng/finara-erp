'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

// Label per path segment. Anything not listed falls back to a title-cased segment.
const LABELS = {
  accounts: 'Chart of Accounts',
  journal: 'General Ledger',
  recurring: 'Recurring Entries',
  receivable: 'Accounts Receivable',
  'cash-sales': 'Cash Sales',
  quotations: 'Quotations',
  customers: 'Customers',
  aging: 'Aging Report',
  payable: 'Accounts Payable',
  vendors: 'Vendors',
  cheques: 'Cheques',
  'purchase-orders': 'Purchase Orders',
  expenses: 'Expense Vouchers',
  'cash-requests': 'Cash Requests',
  assets: 'Fixed Assets',
  bank: 'Bank Reconciliation',
  budget: 'Budgeting',
  audit: 'Audit Trail',
  bir: 'BIR Compliance',
  vat: 'VAT Summary',
  withholding: 'Withholding Tax',
  ewt: 'EWT Summary',
  alphalist: 'Alphalist',
  relief: 'RELIEF Export',
  payroll: 'Payroll',
  employees: 'Employees',
  periods: 'Payroll Periods',
  calculator: 'Calculator',
  reports: 'Reports',
  'trial-balance': 'Trial Balance',
  'income-statement': 'Income Statement',
  'balance-sheet': 'Balance Sheet',
  'cash-position': 'Cash Position',
  sales: 'Sales',
  custom: 'Custom Reports',
  builder: 'Builder',
  school: 'School Billing',
  amortization: 'Amortization',
  assessments: 'Assessments',
  billing: 'Billing',
  collections: 'Collections',
  enrollment: 'Enrollment',
  setup: 'Setup',
  students: 'Students',
  subsidies: 'Subsidies',
  inventory: 'Inventory',
  items: 'Items',
  transactions: 'Transactions',
  remittance: 'Remittance',
  daily: 'Daily',
  records: 'Records',
  orders: 'Orders',
  override: 'Override',
  plans: 'Plans',
  modules: 'Modules',
  'my-businesses': 'My Businesses',
  settings: 'Settings',
  businesses: 'Businesses',
  'opening-balances': 'Opening Balances',
};

const titleCase = (s) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Segments with no page of their own (e.g. /reports) render as plain text, not links.
const NO_PAGE = new Set(['reports']);

const isDynamic = (seg) => /^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || /^c[a-z0-9]{20,}$/.test(seg);

export default function Breadcrumbs() {
  const pathname = usePathname() || '/';
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'dashboard')) return null;

  // /admin/* pages (orders, plans, override) live under Settings in the nav;
  // /modules has no /settings prefix, so Settings is prepended.
  const settingsCrumb = { label: 'Settings', href: '/settings', linkable: true };
  const crumbs = segments.map((seg, i) => (
    seg === 'admin' && i === 0
      ? settingsCrumb
      : {
          label: isDynamic(seg) ? 'Details' : LABELS[seg] || titleCase(seg),
          href: '/' + segments.slice(0, i + 1).join('/'),
          linkable: !NO_PAGE.has(seg),
        }
  ));
  if (segments[0] === 'modules') crumbs.unshift(settingsCrumb);

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <li>
          <Link href="/dashboard" className="flex items-center hover:text-blue-600 dark:hover:text-blue-400" aria-label="Dashboard">
            <Home size={13} />
          </Link>
        </li>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-gray-400" />
              {last ? (
                <span aria-current="page" className="font-medium text-gray-700 dark:text-gray-200">{c.label}</span>
              ) : c.linkable ? (
                <Link href={c.href} className="hover:text-blue-600 dark:hover:text-blue-400">{c.label}</Link>
              ) : (
                <span>{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
