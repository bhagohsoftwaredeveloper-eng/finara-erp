const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

exports.list = async (req, res, next) => {
  try {
    const { type, search, active } = req.query;
    const where = {};
    if (type) where.accountType = type;
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.OR = [
      { accountCode: { contains: search } },
      { accountName: { contains: search } },
    ];

    const accounts = await prisma.account.findMany({
      where,
      include: { parent: { select: { accountCode: true, accountName: true } } },
      orderBy: [{ accountCode: 'asc' }],
    });
    res.json(accounts);
  } catch (err) { next(err); }
};

exports.tree = async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      include: { children: true },
      orderBy: { accountCode: 'asc' },
    });
    // Return only root accounts with nested children
    const roots = accounts.filter((a) => !a.parentId);
    res.json(roots);
  } catch (err) { next(err); }
};

exports.getTypes = (req, res) => {
  res.json(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
};

exports.getOne = async (req, res, next) => {
  try {
    const account = await prisma.account.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        parent: true,
        children: true,
        journalLines: {
          include: { entry: true },
          orderBy: { entry: { entryDate: 'desc' } },
          take: 20,
        },
      },
    });
    if (!account) throw createError('Account not found', 404);

    // Compute running balance
    const debits = account.journalLines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = account.journalLines.reduce((s, l) => s + Number(l.credit), 0);
    res.json({ ...account, balance: debits - credits });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { accountCode, accountName, accountType, normalBalance, parentId, description } = req.body;
    const account = await prisma.account.create({
      data: { accountCode, accountName, accountType, normalBalance, parentId: parentId || null, description },
    });
    res.status(201).json(account);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { accountName, description, isActive } = req.body;
    const account = await prisma.account.update({
      where: { id },
      data: { accountName, description, isActive },
    });
    res.json(account);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    // Check for journal lines
    const lineCount = await prisma.journalLine.count({ where: { accountId: id } });
    if (lineCount > 0) throw createError('Cannot delete account with existing transactions', 400);
    await prisma.account.delete({ where: { id } });
    res.json({ message: 'Account deleted' });
  } catch (err) { next(err); }
};
