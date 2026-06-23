const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const bcrypt = require('bcryptjs');

const genEntryNo = async () => {
  const count = await prisma.journalEntry.count();
  return `JE-${String(count + 1).padStart(6, '0')}`;
};

exports.list = async (req, res, next) => {
  try {
    const { status, from, to, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (from || to) where.entryDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    if (search) where.OR = [{ entryNo: { contains: search } }, { description: { contains: search } }];

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
        orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.journalEntry.count({ where }),
    ]);

    res.json({ data: entries, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const entry = await prisma.journalEntry.findUnique({
      where: { id: Number(req.params.id) },
      include: { lines: { include: { account: true }, orderBy: { lineOrder: 'asc' } } },
    });
    if (!entry) throw createError('Journal entry not found', 404);
    res.json(entry);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { entryDate, reference, description, lines } = req.body;

    // Validate balanced entry
    const totalDebit  = lines.reduce((s, l) => s + Number(l.debit  || 0), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw createError(`Entry is not balanced. Debits: ${totalDebit}, Credits: ${totalCredit}`, 400);
    }

    const entryNo = await genEntryNo();
    const entry = await prisma.journalEntry.create({
      data: {
        entryNo,
        entryDate: new Date(entryDate),
        reference,
        description,
        createdBy: req.user.id,
        lines: {
          create: lines.map((l, i) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            description: l.description,
            lineOrder: i,
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    });
    res.status(201).json(entry);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const entry = await prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw createError('Entry not found', 404);
    if (entry.status !== 'DRAFT') throw createError('Only DRAFT entries can be edited', 400);

    const { description, reference, lines } = req.body;
    if (lines) {
      const totalDebit  = lines.reduce((s, l) => s + Number(l.debit  || 0), 0);
      const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) throw createError('Entry is not balanced', 400);
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.journalLine.deleteMany({ where: { entryId: id } });
        await tx.journalLine.createMany({
          data: lines.map((l, i) => ({ entryId: id, accountId: l.accountId, debit: l.debit || 0, credit: l.credit || 0, description: l.description, lineOrder: i })),
        });
      }
      return tx.journalEntry.update({ where: { id }, data: { description, reference }, include: { lines: true } });
    });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.post = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const entry = await prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw createError('Entry not found', 404);
    if (entry.status !== 'DRAFT') throw createError('Entry is already posted or voided', 400);
    const updated = await prisma.journalEntry.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.void = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { adminPassword, reason } = req.body;

    // ── 1. Find the entry ────────────────────────────────────
    const entry = await prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw createError('Entry not found', 404);
    if (entry.status === 'VOIDED') throw createError('Entry is already voided', 400);

    // ── 2. Verify super admin password ───────────────────────
    // Find any active ADMIN user and verify the supplied password against it.
    // This means only someone who knows an ADMIN account password can void entries.
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
      select: { id: true, email: true, password: true },
    });

    if (admins.length === 0) {
      throw createError('No active admin account found. Contact your system administrator.', 403);
    }

    let authorized = false;
    for (const admin of admins) {
      const match = await bcrypt.compare(adminPassword, admin.password);
      if (match) { authorized = true; break; }
    }

    if (!authorized) {
      throw createError('Incorrect admin password. Void not authorized.', 403);
    }

    // ── 3. Void the entry ────────────────────────────────────
    const updated = await prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'VOIDED',
        description: `[VOIDED] ${entry.description} — Reason: ${reason}`,
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
};

exports.trialBalance = async (req, res, next) => {
  try {
    const { asOf } = req.query;
    const dateFilter = asOf ? { lte: new Date(asOf) } : undefined;
    const where = { entry: { status: 'POSTED', ...(dateFilter && { entryDate: dateFilter }) } };

    const lines = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where,
      _sum: { debit: true, credit: true },
    });

    const accountIds = lines.map((l) => l.accountId);
    const accts = await prisma.account.findMany({ where: { id: { in: accountIds } } });
    const accountMap = Object.fromEntries(accts.map((a) => [a.id, a]));

    const accounts = lines.map((l) => {
      const acc = accountMap[l.accountId];
      const debit  = Number(l._sum.debit)  || 0;
      const credit = Number(l._sum.credit) || 0;
      const balance = debit - credit;
      return {
        id:            l.accountId,
        accountId:     l.accountId,
        accountCode:   acc?.accountCode,
        accountName:   acc?.accountName,
        accountType:   acc?.accountType,
        normalBalance: acc?.normalBalance,
        totalDebit:    debit,
        totalCredit:   credit,
        balance,
        // Positive debit balance = account with a debit balance
        debitBalance:  balance > 0 ? balance : 0,
        creditBalance: balance < 0 ? Math.abs(balance) : 0,
      };
    }).sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

    res.json({ accounts, asOf: asOf || new Date().toISOString() });
  } catch (err) { next(err); }
};

exports.incomeStatement = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const where = {
      entry: {
        status: 'POSTED',
        ...(from || to ? { entryDate: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) } } : {}),
      },
      account: { accountType: { in: ['REVENUE', 'EXPENSE'] } },
    };

    const lines = await prisma.journalLine.findMany({
      where,
      include: { account: { select: { id: true, accountCode: true, accountName: true, accountType: true } } },
    });

    const grouped = {};
    for (const l of lines) {
      const key = l.accountId;
      if (!grouped[key]) grouped[key] = { ...l.account, debit: 0, credit: 0 };
      grouped[key].debit  += Number(l.debit);
      grouped[key].credit += Number(l.credit);
    }

    // Shape each account: add `name`, `code`, `balance` for frontend consumption
    const rows = Object.values(grouped).map((r) => ({
      id:          r.id,
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: r.accountType,
      name:        r.accountName,   // alias expected by frontend
      code:        r.accountCode,   // alias expected by frontend
      balance:     r.accountType === 'REVENUE' ? r.credit - r.debit : r.debit - r.credit,
    })).sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

    // Categorise by account code prefix (Philippine standard CoA convention)
    // 4xxx = Revenue; 5xxx = COGS; 6xxx = Operating Expenses; 7xxx = Other Expenses
    const revenueAccounts      = rows.filter((r) => r.accountType === 'REVENUE' && (r.code || '').startsWith('4') && Number(r.code) < 4500);
    const otherIncomeAccounts  = rows.filter((r) => r.accountType === 'REVENUE' && !revenueAccounts.includes(r));
    const cogsAccounts         = rows.filter((r) => r.accountType === 'EXPENSE' && (r.code || '').startsWith('5'));
    const opexAccounts         = rows.filter((r) => r.accountType === 'EXPENSE' && ((r.code || '').startsWith('6') || (!r.code?.startsWith('5') && !r.code?.startsWith('7'))));
    const otherExpAccounts     = rows.filter((r) => r.accountType === 'EXPENSE' && (r.code || '').startsWith('7'));

    // If no code-based split worked, fall back: all revenue in revenueAccounts, all expense in opexAccounts
    const effectiveRevenue    = revenueAccounts.length > 0 ? revenueAccounts    : rows.filter((r) => r.accountType === 'REVENUE');
    const effectiveCogs       = cogsAccounts;
    const effectiveOpex       = opexAccounts.length  > 0  ? opexAccounts       : rows.filter((r) => r.accountType === 'EXPENSE' && !cogsAccounts.includes(r) && !otherExpAccounts.includes(r));
    const effectiveOtherInc   = otherIncomeAccounts;
    const effectiveOtherExp   = otherExpAccounts;

    const totalRevenue      = effectiveRevenue.reduce((s, r)  => s + r.balance, 0);
    const totalCOGS         = effectiveCogs.reduce((s, r)     => s + r.balance, 0);
    const totalOpex         = effectiveOpex.reduce((s, r)     => s + r.balance, 0);
    const totalOtherIncome  = effectiveOtherInc.reduce((s, r) => s + r.balance, 0);
    const totalOtherExpense = effectiveOtherExp.reduce((s, r) => s + r.balance, 0);
    const netIncome         = totalRevenue + totalOtherIncome - totalCOGS - totalOpex - totalOtherExpense;

    res.json({
      revenueAccounts:      effectiveRevenue,
      cogsAccounts:         effectiveCogs,
      opexAccounts:         effectiveOpex,
      otherIncomeAccounts:  effectiveOtherInc,
      otherExpAccounts:     effectiveOtherExp,
      totalRevenue,
      totalCOGS,
      totalOpex,
      totalOtherIncome,
      totalOtherExpense,
      netIncome,
    });
  } catch (err) { next(err); }
};

exports.balanceSheet = async (req, res, next) => {
  try {
    const { asOf } = req.query;
    const where = {
      entry: { status: 'POSTED', ...(asOf && { entryDate: { lte: new Date(asOf) } }) },
      account: { accountType: { in: ['ASSET', 'LIABILITY', 'EQUITY'] } },
    };

    const lines = await prisma.journalLine.findMany({
      where,
      include: { account: true },
    });

    const grouped = {};
    for (const l of lines) {
      const key = l.accountId;
      if (!grouped[key]) grouped[key] = { ...l.account, debit: 0, credit: 0 };
      grouped[key].debit  += Number(l.debit);
      grouped[key].credit += Number(l.credit);
    }

    // Shape each account with aliases frontend expects
    const accounts = Object.values(grouped).map((r) => {
      const balance = r.accountType === 'ASSET' ? r.debit - r.credit : r.credit - r.debit;
      const debitBalance  = balance > 0 && r.accountType === 'ASSET' ? balance : 0;
      const creditBalance = balance > 0 && r.accountType !== 'ASSET' ? balance : 0;
      return {
        id:            r.id,
        accountCode:   r.accountCode,
        accountName:   r.accountName,
        accountType:   r.accountType,
        normalBalance: r.normalBalance,
        // Aliases used by the balance sheet frontend
        type:          r.accountType,
        code:          r.accountCode,
        name:          r.accountName,
        balance,
        debitBalance,
        creditBalance,
      };
    }).sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

    const assets      = accounts.filter((r) => r.type === 'ASSET');
    const liabilities = accounts.filter((r) => r.type === 'LIABILITY');
    const equity      = accounts.filter((r) => r.type === 'EQUITY');

    res.json({
      accounts,
      assets,      totalAssets:      assets.reduce((s, r) => s + r.balance, 0),
      liabilities, totalLiabilities: liabilities.reduce((s, r) => s + r.balance, 0),
      equity,      totalEquity:      equity.reduce((s, r) => s + r.balance, 0),
      asOf: asOf || new Date().toISOString(),
    });
  } catch (err) { next(err); }
};
