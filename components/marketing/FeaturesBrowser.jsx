'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, BookOpen, FileStack, Wallet, Banknote, ScrollText, BarChart3, Boxes, Landmark, HandCoins } from 'lucide-react';
import { Stagger, StaggerItem } from './Reveal';

const MODULES = [
  { id: 'general-ledger', name: 'General Ledger', category: 'Finance', icon: BookOpen, text: 'PFRS-aligned chart of accounts, journal entries, trial balance.' },
  { id: 'accounts-payable', name: 'Accounts Payable', category: 'Finance', icon: FileStack, text: 'Vendor bills, due dates, and payments with aging reports.' },
  { id: 'accounts-receivable', name: 'Accounts Receivable', category: 'Finance', icon: Banknote, text: 'Invoices, collections, and customer aging at a glance.' },
  { id: 'payroll', name: 'Payroll', category: 'Compliance', icon: Wallet, text: 'SSS, PhilHealth, Pag-IBIG, and BIR TRAIN Law withholding.' },
  { id: 'bir-compliance', name: 'BIR Compliance', category: 'Compliance', icon: ScrollText, text: 'VAT summary, EWT tracking, Alphalist and RELIEF exports.' },
  { id: 'reports', name: 'Reports', category: 'Reporting', icon: BarChart3, text: 'Income statement, balance sheet, trial balance, custom reports.' },
  { id: 'inventory', name: 'Inventory', category: 'Operations', icon: Boxes, text: 'Item master, stock movements, and inventory valuation.' },
  { id: 'cash-banking', name: 'Cash & Banking', category: 'Operations', icon: Landmark, text: 'Cash sales, cheque register, and bank reconciliation.' },
  { id: 'spend-control', name: 'Spend Control', category: 'Operations', icon: HandCoins, text: 'Purchase orders with OCR scan, expense vouchers, cash requests.' },
  { id: 'remittances', name: 'Government Remittances', category: 'Compliance', icon: ScrollText, text: 'SSS, PhilHealth and Pag-IBIG remittance tracking and daily report.' },
];

const CATEGORIES = ['Finance', 'Compliance', 'Reporting', 'Operations'];

export default function FeaturesBrowser() {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter((m) => m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q));
  }, [search]);

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-4">
      <div className="max-w-xl mx-auto relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all modules — e.g. payroll, VAT, inventory..."
          className="w-full pl-12 pr-4 py-3.5 rounded-2xl border border-gray-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)] text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"
        />
      </div>

      <div className="mt-8">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No modules match that search.</p>
        ) : search ? (
          <Stagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((m) => (
              <StaggerItem key={m.id}>
                <Link href={`#${m.id}`} className="group flex items-start gap-3 bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md hover:border-blue-200 hover:-translate-y-0.5 transition-all duration-200">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 text-brand flex items-center justify-center flex-shrink-0 group-hover:bg-brand group-hover:text-white transition-colors">
                    <m.icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm">{m.name}</p>
                    <p className="mt-1 text-xs text-gray-500 leading-relaxed">{m.text}</p>
                  </div>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="flex items-center gap-1.5">
                {MODULES.filter((m) => m.category === cat).map((m) => (
                  <Link
                    key={m.id}
                    href={`#${m.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-brand hover:text-brand transition-colors"
                  >
                    <m.icon className="w-3.5 h-3.5" /> {m.name}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
