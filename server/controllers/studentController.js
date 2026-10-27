/**
 * studentController.js — Student registry, guardians and the student ledger.
 *
 * Every Student owns exactly one Customer row. That pairing is what lets the
 * whole existing AR pipeline — invoices, payments, aging, the BIR sales book —
 * work on student billing with no school-specific branch anywhere in it.
 * The Customer is created with the student and is never exposed as an editable
 * entity of its own, so the two can never drift apart.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { nextDocNumber } = require('../utils/docNumber');
const { recordAudit } = require('../utils/audit');
const policy = require('../utils/schoolPolicy');

const fullName = (s) =>
  [s.lastName + ',', s.firstName, s.middleName, s.suffix].filter(Boolean).join(' ');

/**
 * Next student number, year-prefixed: 2026-0001.
 *
 * Derived from the last issued number, never from a row count — a count is
 * wrong the moment a row is deleted and then collides forever. See
 * utils/docNumber.js for the full reasoning.
 */
async function nextStudentNo(businessId, year) {
  const prefix = `${year}-`;
  const last = await prisma.student.findFirst({
    where:   { businessId, studentNo: { startsWith: prefix } },
    orderBy: { studentNo: 'desc' },
    select:  { studentNo: true },
  });
  return nextDocNumber(prefix, last?.studentNo, 4);
}

/** Next customer code for a student-linked customer: STU-00001. */
async function nextStudentCustomerCode(businessId) {
  const last = await prisma.customer.findFirst({
    where:   { businessId, customerCode: { startsWith: 'STU-' } },
    orderBy: { customerCode: 'desc' },
    select:  { customerCode: true },
  });
  return nextDocNumber('STU-', last?.customerCode, 5);
}

/**
 * Validate the scholarship fields from a request body.
 * Returns the columns to write, or {} when the body did not mention them.
 * FULL and NONE carry no percentage; PARTIAL needs one between 0 and 100.
 */
function scholarshipData({ scholarshipType, scholarshipPct }) {
  if (scholarshipType === undefined) return {};
  if (!['NONE', 'FULL', 'PARTIAL'].includes(scholarshipType)) {
    throw createError('Scholarship must be NONE, FULL or PARTIAL', 400);
  }
  if (scholarshipType !== 'PARTIAL') return { scholarshipType, scholarshipPct: null };
  const pct = Number(scholarshipPct);
  if (!(pct > 0 && pct < 100)) {
    throw createError('Partial scholarship needs a discount between 0 and 100 percent', 400);
  }
  return { scholarshipType, scholarshipPct: pct };
}

// ── Students ───────────────────────────────────────────────────────────────

exports.listStudents = async (req, res, next) => {
  try {
    const { search, status, gradeLevelId, schoolYearId, page = 1, limit = 25 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { lastName:  { contains: search } },
        { firstName: { contains: search } },
        { studentNo: { contains: search } },
        { lrn:       { contains: search } },
      ];
    }
    if (gradeLevelId || schoolYearId) {
      where.enrollments = {
        some: {
          ...(gradeLevelId && { gradeLevelId: Number(gradeLevelId) }),
          ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
          status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] },
        },
      };
    }

    const take = Math.min(Number(limit) || 25, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [students, total, byType] = await Promise.all([
      prisma.student.findMany({
        where, take, skip,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          enrollments: {
            where: { status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] } },
            orderBy: { enrollmentDate: 'desc' },
            take: 1,
            include: {
              gradeLevel: { select: { code: true, name: true } },
              section:    { select: { name: true } },
              schoolYear: { select: { code: true } },
            },
          },
        },
      }),
      prisma.student.count({ where }),
      // Whole-school headcount by student type — ignores the search/status filter.
      prisma.student.groupBy({ by: ['scholarshipType'], where: { businessId: req.businessId }, _count: true }),
    ]);
    const counts = Object.fromEntries(byType.map((r) => [r.scholarshipType, r._count]));
    const summary = {
      total: byType.reduce((t, r) => t + r._count, 0),
      regular: counts.NONE || 0,
      fullScholar: counts.FULL || 0,
      partialScholar: counts.PARTIAL || 0,
    };

    res.json({
      summary,
      items: students.map((s) => ({
        ...s,
        fullName: fullName(s),
        currentEnrollment: s.enrollments[0] || null,
        enrollments: undefined,
      })),
      total, page: Number(page), limit: take,
      pages: Math.ceil(total / take),
    });
  } catch (err) { next(err); }
};

exports.getStudent = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const student = await prisma.student.findFirst({
      where: { id, businessId: req.businessId },
      include: {
        customer:  { select: { id: true, customerCode: true } },
        guardians: { orderBy: { isPrimaryPayer: 'desc' } },
        enrollments: {
          orderBy: { enrollmentDate: 'desc' },
          include: {
            gradeLevel:    true,
            section:       true,
            schoolYear:    true,
            paymentScheme: { select: { code: true, name: true } },
            assessment:    { select: { id: true, assessmentNo: true, netAmount: true, paidAmount: true, status: true } },
            discounts:     true,
            subsidies:     true,
          },
        },
      },
    });
    if (!student) throw createError('Student not found', 404);
    res.json({ ...student, fullName: fullName(student) });
  } catch (err) { next(err); }
};

exports.createStudent = async (req, res, next) => {
  try {
    const {
      lastName, firstName, middleName, suffix, lrn, birthDate, gender,
      address, contactPhone, email, guardians = [], notes,
    } = req.body;
    const scholarship = scholarshipData(req.body);

    if (lrn && !/^\d{12}$/.test(String(lrn))) {
      throw createError('LRN must be exactly 12 digits', 400);
    }
    if (lrn) {
      const dupe = await prisma.student.findFirst({ where: { businessId: req.businessId, lrn: String(lrn) } });
      if (dupe) throw createError(`LRN ${lrn} already belongs to ${fullName(dupe)} (${dupe.studentNo})`, 409);
    }

    const year = new Date().getFullYear();
    const displayName = [lastName + ',', firstName, middleName, suffix].filter(Boolean).join(' ');

    // Retry on the off chance a concurrent create grabbed the same sequential
    // number, exactly as createCustomer does.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const student = await prisma.$transaction(async (tx) => {
          const customer = await tx.customer.create({
            data: {
              businessId:   req.businessId,
              customerCode: await nextStudentCustomerCode(req.businessId),
              name:         displayName,
              address:      address || null,
              contactName:  guardians.find((g) => g.isPrimaryPayer)?.name || guardians[0]?.name || null,
              email:        email || null,
              phone:        contactPhone || null,
            },
          });

          return tx.student.create({
            data: {
              businessId: req.businessId,
              studentNo:  await nextStudentNo(req.businessId, year),
              lrn:        lrn ? String(lrn) : null,
              lastName, firstName,
              middleName: middleName || null,
              suffix:     suffix || null,
              // The registry form is personal-info-only — no enrollment, no
              // assessment, no payment happens here. Only
              // advanceEnrollmentStatus (schoolBillingController.js), after
              // the seat-holding installment is paid, may move a student past
              // this stage.
              status:     'APPLICANT',
              birthDate:  birthDate ? new Date(birthDate) : null,
              gender:     gender || null,
              address:    address || null,
              contactPhone: contactPhone || null,
              email:      email || null,
              notes:      notes || null,
              ...scholarship,
              customerId: customer.id,
              guardians: {
                create: guardians.map((g) => ({
                  name: g.name,
                  relationship: g.relationship || null,
                  phone: g.phone || null,
                  email: g.email || null,
                  occupation: g.occupation || null,
                  isPrimaryPayer: !!g.isPrimaryPayer,
                })),
              },
            },
            include: { guardians: true, customer: { select: { customerCode: true } } },
          });
        });

        await recordAudit({
          action: 'CREATE', entity: 'Student', entityId: String(student.id),
          summary: `Registered student ${student.studentNo} — ${fullName(student)}`,
          user: req.user, businessId: req.businessId,
        });
        return res.status(201).json({ ...student, fullName: fullName(student) });
      } catch (err) {
        if (err.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) { next(err); }
};

exports.updateStudent = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.student.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Student not found', 404);

    const { lastName, firstName, middleName, suffix, lrn, birthDate, gender,
            address, contactPhone, email, status, notes } = req.body;

    if (lrn && !/^\d{12}$/.test(String(lrn))) {
      throw createError('LRN must be exactly 12 digits', 400);
    }
    const scholarship = scholarshipData(req.body);
    if (lrn && lrn !== existing.lrn) {
      const dupe = await prisma.student.findFirst({
        where: { businessId: req.businessId, lrn: String(lrn), id: { not: id } },
      });
      if (dupe) throw createError(`LRN ${lrn} already belongs to ${fullName(dupe)} (${dupe.studentNo})`, 409);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.student.update({
        where: { id },
        data: {
          ...(lastName !== undefined && { lastName }),
          ...(firstName !== undefined && { firstName }),
          ...(middleName !== undefined && { middleName: middleName || null }),
          ...(suffix !== undefined && { suffix: suffix || null }),
          ...(lrn !== undefined && { lrn: lrn ? String(lrn) : null }),
          ...(birthDate !== undefined && { birthDate: birthDate ? new Date(birthDate) : null }),
          ...(gender !== undefined && { gender: gender || null }),
          ...(address !== undefined && { address: address || null }),
          ...(contactPhone !== undefined && { contactPhone: contactPhone || null }),
          ...(email !== undefined && { email: email || null }),
          ...(status !== undefined && { status }),
          ...(notes !== undefined && { notes: notes || null }),
          ...scholarship,
        },
      });

      // Keep the paired Customer in step, or invoices would print a stale name.
      await tx.customer.update({
        where: { id: s.customerId },
        data: {
          name:    fullName(s),
          address: s.address,
          email:   s.email,
          phone:   s.contactPhone,
        },
      });
      return s;
    });

    res.json({ ...updated, fullName: fullName(updated) });
  } catch (err) { next(err); }
};

// ── Suspend / reinstate / delete ───────────────────────────────────────────

exports.suspendStudent = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.student.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Student not found', 404);
    if (existing.status === 'SUSPENDED') throw createError('This student is already suspended', 400);

    const updated = await prisma.student.update({
      where: { id },
      data: { status: 'SUSPENDED', statusBeforeSuspension: existing.status },
    });
    const reason = String(req.body?.reason || '').trim();
    await recordAudit({
      action: 'UPDATE', entity: 'Student', entityId: String(id),
      summary: `Suspended ${existing.studentNo} — ${fullName(existing)}${reason ? ` (${reason})` : ''}`,
      user: req.user, businessId: req.businessId,
    });
    res.json({ ...updated, fullName: fullName(updated) });
  } catch (err) { next(err); }
};

exports.reinstateStudent = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.student.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Student not found', 404);
    if (existing.status !== 'SUSPENDED') throw createError('This student is not suspended', 400);

    const restored = existing.statusBeforeSuspension && existing.statusBeforeSuspension !== 'SUSPENDED'
      ? existing.statusBeforeSuspension : 'ACTIVE';
    const updated = await prisma.student.update({
      where: { id },
      data: { status: restored, statusBeforeSuspension: null },
    });
    await recordAudit({
      action: 'UPDATE', entity: 'Student', entityId: String(id),
      summary: `Reinstated ${existing.studentNo} — ${fullName(existing)} as ${restored}`,
      user: req.user, businessId: req.businessId,
    });
    res.json({ ...updated, fullName: fullName(updated) });
  } catch (err) { next(err); }
};

/**
 * Delete a student record that has no financial history.
 *
 * Anyone who has been enrolled, assessed, billed or refunded stays on the books
 * — deleting them would orphan ledger rows and invoices — so the answer for
 * them is Suspend or a leaving status. Delete is for mistakes and duplicates
 * (an import loaded twice, a mistyped registration).
 */
exports.deleteStudent = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.student.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Student not found', 404);

    const [enrollments, assessments, advances, ledger, adjustments, refunds] = await Promise.all([
      prisma.enrollment.count({ where: { studentId: id } }),
      prisma.assessment.count({ where: { studentId: id } }),
      prisma.studentAdvance.count({ where: { studentId: id } }),
      prisma.studentLedger.count({ where: { studentId: id } }),
      prisma.billingAdjustment.count({ where: { studentId: id } }),
      prisma.refund.count({ where: { studentId: id } }),
    ]);
    if (enrollments + assessments + advances + ledger + adjustments + refunds > 0) {
      throw createError(
        'This student has enrollment or billing history and cannot be deleted. Suspend them instead, or set a leaving status.',
        409,
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.student.delete({ where: { id } });       // guardians cascade
        await tx.customer.delete({ where: { id: existing.customerId } });
      });
    } catch (err) {
      // The paired customer is referenced by an invoice or payment.
      if (err.code === 'P2003' || err.code === 'P2014') {
        throw createError('This student has invoices or payments on file and cannot be deleted. Suspend them instead.', 409);
      }
      throw err;
    }

    await recordAudit({
      action: 'DELETE', entity: 'Student', entityId: String(id),
      summary: `Deleted ${existing.studentNo} — ${fullName(existing)}`,
      user: req.user, businessId: req.businessId,
    });
    res.json({ message: `Deleted ${fullName(existing)}` });
  } catch (err) { next(err); }
};

// ── Guardians ──────────────────────────────────────────────────────────────

exports.saveGuardians = async (req, res, next) => {
  try {
    const studentId = Number(req.params.id);
    const student = await prisma.student.findFirst({ where: { id: studentId, businessId: req.businessId } });
    if (!student) throw createError('Student not found', 404);

    const { guardians = [] } = req.body;
    const primaries = guardians.filter((g) => g.isPrimaryPayer).length;
    if (primaries > 1) throw createError('Only one guardian can be the primary payer', 400);

    const saved = await prisma.$transaction(async (tx) => {
      await tx.guardian.deleteMany({ where: { studentId } });
      if (guardians.length) {
        await tx.guardian.createMany({
          data: guardians.map((g) => ({
            studentId,
            name: g.name,
            relationship: g.relationship || null,
            phone: g.phone || null,
            email: g.email || null,
            occupation: g.occupation || null,
            isPrimaryPayer: !!g.isPrimaryPayer,
          })),
        });
      }
      const payer = guardians.find((g) => g.isPrimaryPayer) || guardians[0];
      await tx.customer.update({
        where: { id: student.customerId },
        data:  { contactName: payer?.name || null },
      });
      return tx.guardian.findMany({ where: { studentId }, orderBy: { isPrimaryPayer: 'desc' } });
    });

    res.json(saved);
  } catch (err) { next(err); }
};

// ── Student ledger ─────────────────────────────────────────────────────────

/**
 * Everything the cashier needs on one screen: what was assessed, what has been
 * billed, what was paid, and what is still owed.
 *
 * Which subledger holds the receivable depends on the revenue policy, same as
 * schoolReportsController.delinquencyReport:
 *
 *   ON_BILLING     Outstanding is computed from invoices — the invoice is
 *                  where the money actually lives, and an assessment that was
 *                  never billed owes nothing yet.
 *   ON_ASSESSMENT  The full year was booked when the assessment posted, so
 *                  invoices only cover what has been billed so far. Reading
 *                  invoices alone would understate what the student owes by
 *                  everything not yet billed — the assessment (and its
 *                  installment schedule, for aging) is the receivable instead.
 */
exports.getLedger = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const student = await prisma.student.findFirst({
      where: { id, businessId: req.businessId },
      include: { customer: true },
    });
    if (!student) throw createError('Student not found', 404);

    const [invoices, assessments, advances] = await Promise.all([
      prisma.invoice.findMany({
        where: { businessId: req.businessId, customerId: student.customerId },
        include: {
          lines:    { include: { account: { select: { accountCode: true, accountName: true } } } },
          payments: { orderBy: { paymentDate: 'asc' } },
        },
        orderBy: { invoiceDate: 'asc' },
      }),
      prisma.assessment.findMany({
        where: { studentId: id, businessId: req.businessId },
        include: {
          installments: { orderBy: { seq: 'asc' } },
          enrollment: {
            include: {
              schoolYear: { select: { code: true } },
              gradeLevel: { select: { code: true, name: true } },
              paymentScheme: { select: { name: true } },
            },
          },
        },
        orderBy: { assessmentDate: 'desc' },
      }),
      prisma.studentAdvance.findMany({
        where: { studentId: id, businessId: req.businessId },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    const live = invoices.filter((i) => i.status !== 'VOID');
    const unappliedCredit = advances.reduce(
      (s, a) => s + (Number(a.amount) - Number(a.appliedAmount)), 0
    );
    const today = new Date();

    const revenuePolicy = await policy.getPolicy(req.businessId);
    let totalBilled, totalPaid, outstanding, overdue;

    if (revenuePolicy === policy.ON_ASSESSMENT) {
      const issued = assessments.filter((a) => ['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(a.status));
      totalBilled = issued.reduce((s, a) => s + (Number(a.netAmount) - Number(a.subsidyAmount)), 0);
      totalPaid   = issued.reduce((s, a) => s + Number(a.paidAmount), 0);
      outstanding = Math.round((totalBilled - totalPaid) * 100) / 100;
      overdue = issued
        .flatMap((a) => a.installments)
        .filter((inst) => inst.status !== 'CANCELLED')
        .reduce((s, inst) => {
          const balance = Number(inst.amount) - Number(inst.paidAmount);
          if (balance <= 0.01 || new Date(inst.dueDate) >= today) return s;
          return s + balance;
        }, 0);
    } else {
      totalBilled = live.reduce((s, i) => s + Number(i.totalAmount), 0);
      totalPaid   = live.reduce((s, i) => s + Number(i.paidAmount), 0);
      outstanding = Math.round((totalBilled - totalPaid) * 100) / 100;
      overdue = live
        .filter((i) => Number(i.totalAmount) - Number(i.paidAmount) > 0.01 && new Date(i.dueDate) < today)
        .reduce((s, i) => s + (Number(i.totalAmount) - Number(i.paidAmount)), 0);
    }

    res.json({
      student: { ...student, fullName: fullName(student) },
      summary: {
        totalBilled:     Math.round(totalBilled * 100) / 100,
        totalPaid:       Math.round(totalPaid * 100) / 100,
        outstanding,
        overdue:         Math.round(overdue * 100) / 100,
        unappliedCredit: Math.round(unappliedCredit * 100) / 100,
      },
      assessments,
      invoices: live.map((i) => ({
        id: i.id, invoiceNo: i.invoiceNo, invoiceDate: i.invoiceDate, dueDate: i.dueDate,
        description: i.description, totalAmount: i.totalAmount, paidAmount: i.paidAmount,
        balance: Math.round((Number(i.totalAmount) - Number(i.paidAmount)) * 100) / 100,
        status: i.status, lines: i.lines, payments: i.payments,
      })),
      advances,
    });
  } catch (err) { next(err); }
};

// ── Bulk import ────────────────────────────────────────────────────────────

/**
 * Import a student roster.
 *
 * Validates the whole batch before writing anything: a half-imported roster is
 * far more work to clean up than a rejected one. Rows already present (matched
 * on LRN) are reported, not duplicated.
 */
exports.importStudents = async (req, res, next) => {
  try {
    const { rows = [], dryRun = false } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw createError('No rows to import', 400);
    if (rows.length > 2000) throw createError('Import at most 2000 rows at a time', 400);

    const errors = [];
    const seenLrn = new Set();

    rows.forEach((r, i) => {
      const line = i + 1;
      if (!r.lastName || !r.firstName) errors.push({ line, error: 'lastName and firstName are required' });
      if (r.lrn) {
        const lrn = String(r.lrn).trim();
        if (!/^\d{12}$/.test(lrn)) errors.push({ line, error: `LRN "${r.lrn}" must be 12 digits` });
        else if (seenLrn.has(lrn)) errors.push({ line, error: `LRN ${lrn} appears twice in this file` });
        else seenLrn.add(lrn);
      }
    });

    const existingLrn = seenLrn.size
      ? await prisma.student.findMany({
          where: { businessId: req.businessId, lrn: { in: [...seenLrn] } },
          select: { lrn: true, studentNo: true, lastName: true, firstName: true },
        })
      : [];
    const existingByLrn = new Map(existingLrn.map((s) => [s.lrn, s]));

    // Duplicates: same LRN, or — when there is no LRN to go by — the same name
    // (last + first + middle, case/spacing-insensitive). Two people with the same
    // name are told apart by birth date when both rows have one.
    const nameKey = (r) => [r.lastName, r.firstName, r.middleName]
      .map((v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    const dayOf = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

    const existingStudents = await prisma.student.findMany({
      where: { businessId: req.businessId },
      select: { lastName: true, firstName: true, middleName: true, birthDate: true, studentNo: true },
    });
    const byName = new Map();
    for (const s of existingStudents) {
      const k = nameKey(s);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(s);
    }
    const sameName = (r, list) => (list || []).find((s) => {
      const a = dayOf(r.birthDate), b = dayOf(s.birthDate);
      return !(a && b && a !== b);
    });

    const duplicates = [];
    const seenInFile = new Map();
    const toCreate = [];
    rows.forEach((r, i) => {
      const label = `${r.lastName}, ${r.firstName}${r.middleName ? ' ' + r.middleName : ''}`;
      if (r.lrn && existingByLrn.has(String(r.lrn).trim())) {
        duplicates.push({ line: i + 1, name: label, reason: 'LRN already on file' });
        return;
      }
      if (!r.lrn) {
        const hit = sameName(r, byName.get(nameKey(r)));
        if (hit) { duplicates.push({ line: i + 1, name: label, reason: `already on file as ${hit.studentNo}` }); return; }
        const k = nameKey(r);
        const earlier = sameName(r, seenInFile.get(k));
        if (earlier) { duplicates.push({ line: i + 1, name: label, reason: 'appears twice in this file' }); return; }
        if (!seenInFile.has(k)) seenInFile.set(k, []);
        seenInFile.get(k).push(r);
      }
      toCreate.push(r);
    });
    const skipped = duplicates.length;

    if (errors.length) {
      return res.status(422).json({
        error: `${errors.length} row${errors.length === 1 ? '' : 's'} could not be imported`,
        details: errors.slice(0, 50),
        wouldCreate: 0, skipped,
      });
    }
    if (dryRun) {
      return res.json({ dryRun: true, wouldCreate: toCreate.length, skipped, duplicates: duplicates.slice(0, 50), errors: [] });
    }

    const year = new Date().getFullYear();
    let created = 0;
    for (const r of toCreate) {
      const displayName = [r.lastName + ',', r.firstName, r.middleName, r.suffix].filter(Boolean).join(' ');
      await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.create({
          data: {
            businessId:   req.businessId,
            customerCode: await nextStudentCustomerCode(req.businessId),
            name:         displayName,
            address:      r.address || null,
            phone:        r.contactPhone || null,
            email:        r.email || null,
          },
        });
        await tx.student.create({
          data: {
            businessId: req.businessId,
            studentNo:  await nextStudentNo(req.businessId, year),
            lrn:        r.lrn ? String(r.lrn).trim() : null,
            lastName:   r.lastName, firstName: r.firstName,
            middleName: r.middleName || null,
            suffix:     r.suffix || null,
            status:     'APPLICANT',
            birthDate:  r.birthDate ? new Date(r.birthDate) : null,
            gender:     r.gender || null,
            address:    r.address || null,
            contactPhone: r.contactPhone || null,
            email:      r.email || null,
            customerId: customer.id,
            guardians: r.guardianName
              ? { create: [{ name: r.guardianName, relationship: r.guardianRelationship || null,
                             phone: r.guardianPhone || null, email: r.guardianEmail || null, isPrimaryPayer: true }] }
              : undefined,
          },
        });
      });
      created++;
    }

    await recordAudit({
      action: 'CREATE', entity: 'Student', entityId: 'bulk',
      summary: `Imported ${created} students`,
      user: req.user, businessId: req.businessId,
    });

    res.json({
      created, skipped, errors: [],
      message: `Imported ${created} student${created === 1 ? '' : 's'}` +
               (skipped ? `. ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped (matched by LRN or name).` : '.'),
    });
  } catch (err) { next(err); }
};
