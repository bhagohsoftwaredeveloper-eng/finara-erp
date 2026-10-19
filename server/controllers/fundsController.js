const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { parsePeriod } = require('../utils/rangeParams');
const { getFundSettings, saveFundSettings } = require('../utils/fundSettings');
const { buildFundSummary } = require('../utils/fundLedger');

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
