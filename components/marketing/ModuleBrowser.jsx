'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, BookOpen, FileStack, Wallet, Banknote, ScrollText, BarChart3, Landmark, HandCoins } from 'lucide-react';
import { Reveal, Stagger, StaggerItem } from './Reveal';

const MODULES = [
  {
    id: 'general-ledger', name: 'General Ledger', category: 'Finance', icon: BookOpen,
    text: 'PFRS-aligned chart of accounts, journal entries, trial balance.',
    href: '#general-ledger', tag: 'PFRS-Aligned',
  },
  {
    id: 'accounts-payable', name: 'Accounts Payable', category: 'Finance', icon: FileStack,
    text: 'Vendor bills, due dates, and payments with aging reports.',
    href: '/features#accounts-payable',
  },
  {
    id: 'accounts-receivable', name: 'Accounts Receivable', category: 'Finance', icon: Banknote,
    text: 'Invoices, collections, and customer aging at a glance.',
    href: '/features#accounts-receivable',
  },
  {
    id: 'payroll', name: 'Payroll', category: 'Compliance', icon: Wallet,
    text: 'SSS, PhilHealth, Pag-IBIG, and BIR TRAIN Law withholding.',
    href: '#payroll', tag: 'TRAIN Law',
  },
  {
    id: 'bir-compliance', name: 'BIR Compliance', category: 'Compliance', icon: ScrollText,
    text: 'VAT summary, EWT tracking, Alphalist and RELIEF exports.',
    href: '#bir-compliance', tag: 'VAT · EWT · Alphalist',
  },
  {
    id: 'reports', name: 'Reports', category: 'Reporting', icon: BarChart3,
    text: 'Income statement, balance sheet, trial balance, custom reports.',
    href: '#reports',
  },
  {
    id: 'cash-banking', name: 'Cash & Banking', category: 'Finance', icon: Landmark,
    text: 'Cash sales, cheque register, and bank reconciliation.',
    href: '/features#cash-banking',
  },
  {
    id: 'spend-control', name: 'Spend Control', category: 'Finance', icon: HandCoins,
    text: 'Purchase orders with OCR scan, expense vouchers, cash requests.',
    href: '/features#spend-control',
  },
  {
    id: 'remittances', name: 'Government Remittances', category: 'Compliance', icon: Landmark,
    text: 'SSS, PhilHealth and Pag-IBIG remittance tracking and daily report.',
    href: '/features#remittances',
  },
];

const CATEGORIES = ['Finance', 'Compliance', 'Reporting'];
const FEATURED_IDS = ['payroll', 'general-ledger', 'bir-compliance'];

function ModuleCard({ mod }) {
  return (
    <Link
      href={mod.href}
      className="group flex items-start gap-3 bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-200"
    >
      <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center flex-shrink-0 group-hover:bg-brand group-hover:text-white transition-colors">
        <mod.icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="font-bold text-gray-900 text-sm">{mod.name}</p>
        <p className="mt-1 text-xs text-gray-500 leading-relaxed">{mod.text}</p>
      </div>
    </Link>
  );
}

export default function ModuleBrowser() {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter(
      (m) => m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
    );
  }, [search]);

  const featured = MODULES.filter((m) => FEATURED_IDS.includes(m.id));

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 -mt-6 sm:-mt-8 pb-14 sm:pb-20">
      {/* Search */}
      <Reveal>
        <div className="max-w-xl mx-auto relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules — e.g. payroll, VAT, reports..."
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"
          />
        </div>
      </Reveal>

      {/* Featured — only when not actively searching */}
      {!search && (
        <div className="mt-10">
          <p className="text-xs font-bold tracking-widest uppercase text-brand mb-4 text-center">Featured</p>
          <Stagger className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {featured.map((m) => (
              <StaggerItem key={m.id}>
                <Link
                  href={m.href}
                  className="group block h-full bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-lg hover:border-blue-200 hover:-translate-y-1 transition-all duration-200"
                >
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-brand flex items-center justify-center mb-4 group-hover:bg-brand group-hover:text-white transition-colors">
                    <m.icon className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-gray-900">{m.name}</p>
                  <p className="mt-1.5 text-xs text-gray-500 leading-relaxed">{m.text}</p>
                  {m.tag && (
                    <span className="mt-3 inline-block px-2.5 py-1 rounded-full bg-blue-50 text-brand text-[11px] font-semibold">
                      {m.tag}
                    </span>
                  )}
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      )}

      {/* Shop by category */}
      <div className="mt-12">
        <p className="text-xs font-bold tracking-widest uppercase text-brand mb-4 text-center">
          {search ? `Results for "${search}"` : 'Shop by category'}
        </p>

        {filtered.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No modules match that search.</p>
        ) : search ? (
          <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((m) => (
              <StaggerItem key={m.id}><ModuleCard mod={m} /></StaggerItem>
            ))}
          </Stagger>
        ) : (
          <div className="space-y-8">
            {CATEGORIES.map((cat) => (
              <div key={cat}>
                <p className="text-sm font-bold text-gray-700 mb-3">{cat}</p>
                <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {MODULES.filter((m) => m.category === cat).map((m) => (
                    <StaggerItem key={m.id}><ModuleCard mod={m} /></StaggerItem>
                  ))}
                </Stagger>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
