const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { parsePeriod } = require('../utils/rangeParams');
const { getFundSettings, saveFundSettings } = require('../utils/fundSettings');
const { buildFundSummary } = require('../utils/fundLedger');
const { loadLines } = require('../utils/glLines');
const { buildStatement } = require('../utils/profitLoss');
const glPost = require('../utils/glPost');
const { recordAudit } = require('../utils/audit');

const FUNDS = ['revolving', 'marketing'];

exports.getConfig = async (req, res, next) => {
  try {
    res.json(await getFundSettings(req.businessId));
  } catch (err) { next(err); }
};

exports.saveConfig = async (req, res, next) => {
  try {
    res.json(await saveFundSettings(req.businessId, req.body));
  } catch (err) { next(err); }
};

// Creates the Marketing Fund asset account (under Current Assets) when it is not in the chart yet.
exports.createMarketingAccount = async (req, res, next) => {
  try {
    const { accountCode } = (await getFundSettings(req.businessId)).marketing;
    const existing = await prisma.account.findFirst({ where: { businessId: req.businessId, accountCode } });
    if (existing) return res.json({ created: false, account: existing });

    const parent = await prisma.account.findFirst({ where: { businessId: req.businessId, accountCode: '1000' } });
    const account = await prisma.account.create({
      data: {
        businessId: req.businessId, accountCode, accountName: 'Marketing Fund',
        accountType: 'ASSET', normalBalance: 'DEBIT', ...(parent && { parentId: parent.id }),
        description: 'Cash set aside for marketing; allocations in, marketing expenses out.',
      },
    });
    res.status(201).json({ created: true, account });
  } catch (err) { next(err); }
};

// Opening / in / out / closing and ledger of a fund over a date range.
exports.getSummary = async (req, res, next) => {
  try {
    const fund = req.query.fund;
    if (!FUNDS.includes(fund)) throw createError(`fund must be one of ${FUNDS.join(', ')}`, 400);
    const { from, to } = parsePeriod(req.query);

    const settings = await getFundSettings(req.businessId);
    const codes = fund === 'revolving' ? settings.revolving.accountCodes : [settings.marketing.accountCode];

    const found = await prisma.account.findMany({
      where: { businessId: req.businessId, accountCode: { in: codes } },
      select: { id: true, accountCode: true, accountName: true, accountType: true },
    });
    const fundAccounts = codes.map((c) => found.find((a) => a.accountCode === c)).filter(Boolean);
    const missingCodes = codes.filter((c) => !found.some((a) => a.accountCode === c));

    let entries = [];
    if (fundAccounts.length > 0) {
      entries = await prisma.journalEntry.findMany({
        where: {
          businessId: req.businessId, status: 'POSTED',
          entryDate: { lte: new Date(`${to}T00:00:00Z`) },
          lines: { some: { accountId: { in: fundAccounts.map((a) => a.id) } } },
        },
        include: { lines: { include: { account: { select: { id: true, accountCode: true, accountName: true, accountType: true } } } } },
        orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      });
    }

    res.json({ fund, from, to, accountCodes: codes, missingCodes, ...buildFundSummary(entries, { fundAccounts, from, to }) });
  } catch (err) { next(err); }
};

// ─── Marketing Fund allocation: a percent of a month's net income, set aside ──────
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw createError('month must be in YYYY-MM format', 400);
  const [y, m] = month.split('-').map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

// What the allocation for a month would be, and whether it can be posted. Always worked
// out on the server; the client never supplies the amount.
async function computeAllocation(businessId, month) {
  const { from, to } = monthBounds(month);
  const { marketing } = await getFundSettings(businessId);

  const lines = await loadLines(businessId, from, to, ['REVENUE', 'EXPENSE']);
  const statement = buildStatement(lines.map((l) => ({ ...l, col: 'a' })), [{ key: 'a', label: month }]);
  const netIncome = statement.summary.netIncome.total;
  const amount = netIncome > 0 ? round2((netIncome * marketing.percent) / 100) : 0;

  const reference = `MKT-ALLOC-${month}`;
  const [existing, accounts] = await Promise.all([
    prisma.journalEntry.findFirst({
      where: { businessId, reference, status: 'POSTED' }, select: { id: true, entryNo: true },
    }),
    prisma.account.findMany({
      where: { businessId, accountCode: { in: [marketing.accountCode, marketing.sourceAccountCode] } },
      select: { accountCode: true },
    }),
  ]);
  const accountsMissing = [marketing.accountCode, marketing.sourceAccountCode].filter((c) => !accounts.some((a) => a.accountCode === c));

  return { month, from, to, reference, netIncome, marketing, amount, existing, accountsMissing };
}

exports.getAllocation = async (req, res, next) => {
  try {
    const a = await computeAllocation(req.businessId, req.query.month);
    res.json({
      month: a.month, from: a.from, to: a.to, netIncome: a.netIncome, percent: a.marketing.percent, amount: a.amount,
      enabled: a.marketing.enabled, fundAccountCode: a.marketing.accountCode, sourceAccountCode: a.marketing.sourceAccountCode,
      alreadyAllocated: a.existing ? { entryNo: a.existing.entryNo } : null, accountsMissing: a.accountsMissing,
    });
  } catch (err) { next(err); }
};

exports.postAllocation = async (req, res, next) => {
  try {
    const a = await computeAllocation(req.businessId, req.body.month);
    const { marketing } = a;
    if (!marketing.enabled) throw createError('The Marketing Fund is not switched on. Turn it on in the Marketing Fund settings first.', 400);
    if (a.accountsMissing.length) throw createError(`Missing account ${a.accountsMissing.join(', ')}. Create it in the chart of accounts first.`, 400);
    if (a.existing) throw createError(`${a.month} was already allocated (${a.existing.entryNo}). Void that entry if it has to be redone.`, 409);
    if (!(a.amount > 0)) throw createError(`There is no net income to allocate for ${a.month}.`, 400);

    const entry = await glPost.post({
      entryDate: a.to,
      description: `Marketing Fund allocation — ${marketing.percent}% of net income for ${a.month}`,
      reference: a.reference,
      lines: [
        { accountCode: marketing.accountCode, debit: a.amount, description: `${marketing.percent}% of ${a.month} net income` },
        { accountCode: marketing.sourceAccountCode, credit: a.amount, description: `Set aside for marketing — ${a.month}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (entry.skipped) throw createError(`${a.month} is before this business's books start date, so nothing can be posted for it.`, 400);

    await recordAudit({
      req, action: 'CREATE', entity: 'JournalEntry', entityId: entry.id,
      summary: `Marketing Fund allocation for ${a.month}: ${a.amount} (${marketing.percent}% of ${a.netIncome})`,
    });
    res.status(201).json({ month: a.month, amount: a.amount, netIncome: a.netIncome, percent: marketing.percent, entryNo: entry.entryNo, entryId: entry.id });
  } catch (err) { next(err); }
};
