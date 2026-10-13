import ModuleShowcase from '@/components/marketing/ModuleShowcase';
import FeaturesBrowser from '@/components/marketing/FeaturesBrowser';
import CTABanner from '@/components/marketing/CTABanner';
import { Reveal, Stagger, StaggerItem } from '@/components/marketing/Reveal';
import {
  Landmark, RefreshCcw, PiggyBank, Briefcase, ScrollText, Building2, ShoppingCart, Wallet,
  Banknote, HandCoins, FileCheck2, Receipt,
} from 'lucide-react';

export const metadata = {
  title: 'Features',
  description:
    'Explore every Finara module — general ledger, AP, AR, payroll, BIR compliance, reports, and inventory.',
};

const MODULES = [
  {
    id: 'general-ledger',
    kicker: 'General Ledger',
    title: 'The core of your books',
    description:
      'Full double-entry accounting with a PFRS-aligned chart of accounts. Journal entries move through draft, posted, and voided states, and every posting is traceable.',
    bullets: [
      '52 PFRS-aligned accounts, extendable to your needs',
      'Draft → posted → voided workflow',
      'Trial balance with drill-down to source entries',
    ],
    image: '/marketing/screenshots/journal.png',
    alt: 'Finara General Ledger',
  },
  {
    id: 'accounts-payable',
    kicker: 'Accounts Payable',
    title: 'Know what you owe, and when',
    description:
      'Manage vendors, record bills, schedule payments, and watch aging buckets so nothing slips past due.',
    bullets: [
      'Vendor registry with TIN and contact details',
      'Bills with due-date tracking and partial payments',
      'AP aging report by vendor and bucket',
    ],
    image: '/marketing/screenshots/payable.png',
    alt: 'Finara Accounts Payable',
  },
  {
    id: 'accounts-receivable',
    kicker: 'Accounts Receivable',
    title: 'Invoice, collect, and stay on top of customers',
    description:
      'From quotation to invoice to collection — track every peso your customers owe with clear aging.',
    bullets: [
      'Quotations that convert to invoices',
      'Collections with automatic ledger posting',
      'AR aging report by customer and bucket',
    ],
    image: '/marketing/screenshots/receivable.png',
    alt: 'Finara Accounts Receivable',
  },
  {
    id: 'payroll',
    kicker: 'Payroll',
    title: 'Philippine payroll, computed correctly',
    description:
      'SSS, PhilHealth, Pag-IBIG, and BIR TRAIN Law withholding are computed from built-in statutory tables every payroll period.',
    bullets: [
      'Statutory contribution tables maintained in-system',
      'TRAIN Law withholding tax computation',
      'Payslips and remittance-ready summaries',
    ],
    image: '/marketing/screenshots/payroll.png',
    alt: 'Finara Payroll',
  },
  {
    id: 'bir-compliance',
    kicker: 'BIR Compliance',
    title: 'File with confidence',
    description:
      'Your BIR reports come straight from posted books — VAT summaries, expanded withholding, Alphalist, and RELIEF exports.',
    bullets: [
      'VAT (2550) summary from actual transactions',
      'EWT tracking per vendor',
      'Alphalist & RELIEF export formats',
    ],
    image: '/marketing/screenshots/bir.png',
    alt: 'Finara BIR Compliance',
  },
  {
    id: 'reports',
    kicker: 'Reports',
    title: 'Answers, not exports',
    description:
      'Standard financial statements are one click away, and the custom report builder covers everything else.',
    bullets: [
      'Income statement, balance sheet, trial balance',
      'Custom report builder with saved reports',
      'Print-ready output with your company letterhead',
    ],
    image: '/marketing/screenshots/reports.png',
    alt: 'Finara Reports',
  },
  {
    id: 'inventory',
    kicker: 'Inventory',
    title: 'Stock that ties to your books',
    description:
      'Track items and stock movements with valuation that flows into your financials automatically.',
    bullets: [
      'Item master with categories and units',
      'Stock-in, stock-out, and adjustment transactions',
      'Inventory valuation reports',
    ],
    image: '/marketing/screenshots/inventory.png',
    alt: 'Finara Inventory',
  },
  {
    id: 'cash-banking',
    kicker: 'Cash & Banking',
    title: 'Every peso in and out, reconciled',
    description:
      'Record over-the-counter cash sales, issue and track cheques, and reconcile your books against the bank statement.',
    bullets: [
      'Cash sales posted straight to the ledger',
      'Cheque register for issued and cleared cheques',
      'Bank reconciliation with cash position reporting',
    ],
    icon: Banknote,
  },
  {
    id: 'spend-control',
    kicker: 'Spend Control',
    title: 'Approve spending before it happens',
    description:
      'From purchase order to expense voucher to cash request, keep every outgoing peso documented and approved.',
    bullets: [
      'Purchase orders you can convert into vendor bills',
      'Scan a supplier PO and let OCR fill in the details',
      'Expense vouchers and cash requests with approval flow',
    ],
    icon: HandCoins,
  },
  {
    id: 'remittances',
    kicker: 'Government Remittances',
    title: 'SSS, PhilHealth and Pag-IBIG, on schedule',
    description:
      'Track what you owe each agency and what you have already remitted, with a daily report for the person who does the filing.',
    bullets: [
      'Remittance dashboard of amounts due per agency',
      'Government records kept per payroll period',
      'Daily remittance report',
    ],
    icon: Landmark,
  },
];

const MORE = [
  { icon: ShoppingCart, label: 'Purchase Orders' },
  { icon: Wallet,       label: 'Expense Vouchers' },
  { icon: HandCoins,    label: 'Cash Requests' },
  { icon: Receipt,      label: 'Cash Sales' },
  { icon: FileCheck2,   label: 'Cheque Register' },
  { icon: PiggyBank,    label: 'Budgeting' },
  { icon: Briefcase,    label: 'Fixed Assets' },
  { icon: Landmark,     label: 'Bank & Reconciliation' },
  { icon: RefreshCcw,   label: 'Recurring Entries' },
  { icon: ScrollText,   label: 'Audit Trail' },
  { icon: Building2,    label: 'Multi-Business' },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-blue-50/80 to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-8 text-center">
          <Reveal>
            <p className="text-xs font-bold tracking-widest uppercase text-brand mb-3">Features</p>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900">
              Every module, working from one ledger
            </h1>
            <p className="mt-4 max-w-2xl mx-auto text-gray-500 text-base sm:text-lg">
              No sync jobs, no imports between tools — each module posts to the same
              double-entry core.
            </p>
          </Reveal>
        </div>
      </section>

      <FeaturesBrowser />

      {MODULES.map((m, i) => (
        <ModuleShowcase key={m.kicker} {...m} reverse={i % 2 === 1} />
      ))}

      <section className="bg-gray-50/70 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <Reveal className="text-center">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              …and the operations around them
            </h2>
          </Reveal>
          <Stagger className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {MORE.map((m) => (
              <StaggerItem key={m.label}>
                <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 px-4 py-3.5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <m.icon className="w-5 h-5 text-brand flex-shrink-0" />
                  <span className="text-sm font-semibold text-gray-800">{m.label}</span>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <div className="pt-16">
        <CTABanner />
      </div>
    </>
  );
}
