/**
 * glPost.js — Automatic GL Journal Entry Posting Utility
 *
 * Usage:
 *   const glPost = require('./glPost');
 *   await glPost.safePost({ entryDate, description, reference, lines, userId, businessId });
 *
 * Each line: { accountCode?, accountId?, debit?, credit?, description? }
 * Supply EITHER accountCode (looks up by COA code within the business) OR accountId directly.
 */

const prisma = require('../config/database');

// ── In-memory account cache — key: `${businessId}:${accountCode}` ─────────────
const _cache = {};

async function getAccountByCode(code, businessId = 1) {
  const key = `${businessId}:${code}`;
  if (_cache[key]) return _cache[key];
  const acc = await prisma.account.findFirst({ where: { accountCode: code, businessId } });
  if (!acc) throw new Error(`GL: No account "${code}" in COA for businessId ${businessId}`);
  _cache[key] = acc;
  return acc;
}

// ── Sequential entry number ────────────────────────────────────────────────────
async function nextEntryNo(businessId = 1) {
  const last = await prisma.journalEntry.findFirst({
    where:   { businessId },
    orderBy: { id: 'desc' },
  });
  const seq = last ? last.id + 1 : 1;
  return `JE-${businessId}-${String(seq).padStart(6, '0')}`;
}

// ── Main post function ─────────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {Date|string} opts.entryDate
 * @param {string}      opts.description
 * @param {string}      [opts.reference]
 * @param {number}      [opts.userId=1]
 * @param {number}      [opts.businessId=1]
 * @param {Array}       opts.lines  — [{accountCode|accountId, debit, credit, description}]
 */
async function post({ entryDate, description, reference, lines, userId = 1, businessId = 1 }) {
  const resolved = await Promise.all(
    lines.map(async (l, i) => {
      let accountId;
      if (l.accountId) {
        accountId = l.accountId;
      } else if (l.accountCode) {
        const acc = await getAccountByCode(l.accountCode, businessId);
        accountId = acc.id;
      } else {
        throw new Error(`GL line[${i}] must have accountId or accountCode`);
      }
      return {
        accountId,
        debit:       Number(l.debit  || 0),
        credit:      Number(l.credit || 0),
        description: l.description || null,
        lineOrder:   i + 1,
      };
    })
  );

  // Validate balance
  const totalDebit  = resolved.reduce((s, l) => s + l.debit,  0);
  const totalCredit = resolved.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(`GL: Entry not balanced — DR ${totalDebit.toFixed(2)}, CR ${totalCredit.toFixed(2)}`);
  }

  const entryNo = await nextEntryNo(businessId);

  return prisma.journalEntry.create({
    data: {
      businessId,
      entryNo,
      entryDate:   entryDate instanceof Date ? entryDate : new Date(entryDate),
      reference:   reference || null,
      description,
      status:      'POSTED',
      createdBy:   Number(userId),
      postedAt:    new Date(),
      lines: { create: resolved },
    },
    include: { lines: true },
  });
}

// ── Silently post — never throws; logs error instead ──────────────────────────
async function safePost(opts) {
  try {
    return await post(opts);
  } catch (err) {
    console.error('[GL AUTO-POST ERROR]', err.message, '| ref:', opts.reference, '| biz:', opts.businessId);
    return null;
  }
}

module.exports = { post, safePost, getAccountByCode };
