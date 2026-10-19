// Tenant-isolation scanner: flags prisma queries on business-scoped models
// whose statement (and its nearby variable context) lacks a businessId filter.
//
// Accuracy improvements over a naive window:
//   1. Extracts the FULL call statement via balanced parentheses (a 250-char
//      window truncates big where clauses, causing false positives).
//   2. Looks BACKWARD 200 chars too — controllers commonly build
//      `const where = { businessId: req.businessId }` above the call.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'server', 'controllers');

const BUSINESS_SCOPED = new Set([
  'account', 'journalEntry', 'journalLine', 'vendor', 'bill', 'billLine', 'paymentAP',
  'customer', 'invoice', 'invoiceLine', 'paymentAR', 'quotation', 'employee',
  'payrollPeriod', 'payrollItem', 'inventoryCategory', 'inventoryItem', 'inventoryTransaction',
  'remittancePeriod', 'expenseVoucher', 'cashDenominationCount', 'dailyRemittance',
  'customReport', 'purchaseOrder', 'fixedAsset', 'bankAccount', 'budget',
  'recurringTemplate', 'cashRequest', 'cashSale', 'schoolYear', 'gradeLevel', 'section',
  'student', 'feeType', 'feeStructure', 'paymentScheme', 'enrollment', 'assessment',
  'studentAdvance', 'amortizationRun', 'studentLedger', 'billingAdjustment', 'refund',
  'paymentSettlement', 'systemSetting', 'attachment',
]);

const OPS = ['findUnique', 'findFirst', 'findMany', 'update', 'updateMany', 'delete', 'deleteMany', 'count', 'aggregate', 'groupBy'];
const INCLUDE_ONLY_OPS = /findAll/; // none — placeholder

// Extract the full parenthesized call starting at index of '('
function balancedCall(src, openIdx) {
  let depth = 0, i = openIdx;
  let inStr = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return src.slice(openIdx + 1, Math.min(openIdx + 600, src.length));
}

const findings = [];
let total = 0;
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  for (const model of BUSINESS_SCOPED) {
    for (const op of OPS) {
      const re = new RegExp(`prisma\\.${model}\\.${op}\\(`, 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        total++;
        const lineNo = src.slice(0, m.index).split('\n').length;
        const stmt = balancedCall(src, m.index + `prisma.${model}.${op}(`.length - 1);
        const before = src.slice(Math.max(0, m.index - 200), m.index);
        // Skip the raw-SQL file odd case: $queryRaw unaffected.
        if (/businessId/.test(stmt) || /businessId/.test(before)) continue;
        findings.push(`${file}:${lineNo}: prisma.${model}.${op}(...)`);
      }
    }
  }
}
console.log(findings.map((f) => '  ' + f).join('\n'));
console.log(`\nScanned ${total} queries on business-scoped models`);
console.log(`Flagged (no businessId in stmt or preceding 200 chars): ${findings.length}`);
