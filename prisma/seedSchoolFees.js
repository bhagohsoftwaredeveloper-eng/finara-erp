/**
 * seedSchoolFees.js — fee schedule per grade level for BRIDGES-style schools.
 *
 *   node prisma/seedSchoolFees.js --business=6
 *
 * Idempotent. Needs seedSchool.js to have run first (fee types, payment schemes)
 * and a current school year. Creates any missing grade level, then writes one
 * fee structure per grade for the current school year.
 *
 * Registration and Miscellaneous are ONE_TIME (due upon enrollment); Tuition is
 * ANNUAL and is spread over the 10-payment scheme, so the monthly amount is
 * exactly the school's quoted monthly fee (4,200 / 4,300).
 */

const prisma = require('../server/config/database');

const EXTRA_GRADE_LEVELS = [
  { code: 'TP', name: 'Toddler Playground', stage: 'PRESCHOOL', sortOrder: 5 },
  { code: 'PK', name: 'Pre-Kinder',         stage: 'PRESCHOOL', sortOrder: 15 },
  { code: 'K',  name: 'Kinder',             stage: 'PRESCHOOL', sortOrder: 22 },
];

const MONTHS = 10;
const GROUPS = [
  { codes: ['TP', 'NUR', 'PK', 'K'],         registration: 6000, misc: 4000,  monthly: 4200 },
  { codes: ['G1', 'G2', 'G3'],               registration: 6000, misc: 12000, monthly: 4200 },
  { codes: ['G4', 'G5', 'G6'],               registration: 6000, misc: 14000, monthly: 4200 },
  { codes: ['G7', 'G8', 'G9', 'G10'],        registration: 6000, misc: 16000, monthly: 4300 },
];

function parseBusinessId() {
  const arg = process.argv.find((a) => a.startsWith('--business='));
  const id = arg ? Number(arg.split('=')[1]) : NaN;
  if (!Number.isInteger(id) || id < 1) {
    console.error('Usage: node prisma/seedSchoolFees.js --business=<id>');
    process.exit(1);
  }
  return id;
}

async function main() {
  const businessId = parseBusinessId();

  const schoolYear = await prisma.schoolYear.findFirst({ where: { businessId, isCurrent: true } });
  if (!schoolYear) throw new Error('No current school year for business ' + businessId);

  const feeTypes = await prisma.feeType.findMany({ where: { businessId, code: { in: ['REG', 'MISC', 'TUITION'] } } });
  const ft = Object.fromEntries(feeTypes.map((f) => [f.code, f]));
  for (const c of ['REG', 'MISC', 'TUITION']) {
    if (!ft[c]) throw new Error(`Fee type ${c} missing — run prisma/seedSchool.js --business=${businessId} first`);
  }

  for (const g of EXTRA_GRADE_LEVELS) {
    const exists = await prisma.gradeLevel.findFirst({ where: { businessId, code: g.code } });
    if (!exists) { await prisma.gradeLevel.create({ data: { businessId, ...g } }); console.log('  + grade level', g.name); }
  }

  const levels = await prisma.gradeLevel.findMany({ where: { businessId } });
  const byCode = Object.fromEntries(levels.map((l) => [l.code, l]));

  for (const grp of GROUPS) {
    const tuition = grp.monthly * MONTHS;
    for (const code of grp.codes) {
      const level = byCode[code];
      if (!level) { console.warn('  ! missing grade level', code); continue; }

      const lines = [
        { feeTypeId: ft.REG.id,     amount: grp.registration, billingBasis: 'ONE_TIME', sortOrder: 0 },
        { feeTypeId: ft.MISC.id,    amount: grp.misc,         billingBasis: 'ONE_TIME', sortOrder: 1 },
        { feeTypeId: ft.TUITION.id, amount: tuition,          billingBasis: 'ANNUAL',   sortOrder: 2 },
      ];
      const name = `${level.name} — ${schoolYear.code}`;
      const existing = await prisma.feeStructure.findFirst({
        where: { businessId, schoolYearId: schoolYear.id, gradeLevelId: level.id },
      });

      if (existing) {
        await prisma.$transaction(async (tx) => {
          await tx.feeStructureLine.deleteMany({ where: { feeStructureId: existing.id } });
          await tx.feeStructure.update({ where: { id: existing.id }, data: { name, isActive: true, lines: { create: lines } } });
        });
      } else {
        await prisma.feeStructure.create({
          data: { businessId, schoolYearId: schoolYear.id, gradeLevelId: level.id, name, lines: { create: lines } },
        });
      }
      const total = grp.registration + grp.misc + tuition;
      console.log(`  ${existing ? '~' : '+'} ${level.name}: ${total.toLocaleString()}`);
    }
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
