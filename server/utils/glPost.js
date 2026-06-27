/**
 * glPost.js — Automatic GL Journal Entry Posting Utility
 *
 * Usage:
 *   const glPost = require('./glPost');
 *   await glPost.post({ entryDate, description, reference, lines, userId });
 *
 * Each line: { accountCode?, accountId?, debit?, credit?, description? }
 * Supply EITHER accountCode (looks up by COA code) OR accountId (uses directly).
 */

const prisma = require('../config/database');

// ── In-memory account cache (keyed by accountCode) ────────────────────────────
const _codeCache = {};
const _idCache   = {};

async function getAccountByCode(code) {
  if (_codeCache[code]) return _codeCache[code];
  const acc = await prisma.account.findFirst({ where: { accountCode: code } });
  if (!acc) throw new Error(`GL: Chart of Accounts has no account with code "${code}"`);
  _codeCache[code] = acc;
  _idCache[acc.id] = acc;
  return acc;
}

// ── Sequential entry number ────────────────────────────────────────────────────
async function nextEntryNo() {
  const last = await prisma.journalEntry.findFirst({ orderBy: { id: 'desc' } });
  const seq  = last ? last.id + 1 : 1;
  return `JE-${String(seq).padStart(6, '0')}`;
}

// ── Main post function ─────────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {Date|string} opts.entryDate
 * @param {string}      opts.description
 * @param {string}      [opts.reference]
 * @param {number}      [opts.userId=1]   - createdBy user id
 * @param {Array}       opts.lines        - [{accountCode|accountId, debit, credit, description}]
 * @returns {Promise<JournalEntry>}
 */
async function post({ entryDate, description, reference, lines, userId = 1 }) {
  // Resolve accountId for each line
  const resolved = await Promise.all(
    lines.map(async (l, i) => {
      let accountId;
      if (l.accountId) {
        accountId = l.accountId;
      } else if (l.accountCode) {
        const acc = await getAccountByCode(l.accountCode);
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

  // Validate debits == credits (rounding tolerance ±0.02)
  const totalDebit  = resolved.reduce((s, l) => s + l.debit,  0);
  const totalCredit = resolved.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(`GL: Entry not balanced — debits ${totalDebit.toFixed(2)}, credits ${totalCredit.toFixed(2)}`);
  }

  const entryNo = await nextEntryNo();

  const entry = await prisma.journalEntry.create({
    data: {
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

  return entry;
}

// ── Convenience: silently post (logs error, never throws) ─────────────────────
// Use this so a GL mapping gap doesn't break the underlying business transaction.
async function safePost(opts) {
  try {
    return await post(opts);
  } catch (err) {
    console.error('[GL AUTO-POST ERROR]', err.message, '| ref:', opts.reference);
    return null;
  }
}

module.exports = { post, safePost, getAccountByCode };
