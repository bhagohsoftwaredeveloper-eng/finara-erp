// Item packaging maths shared by the Express API and the Next.js UI (CommonJS,
// like lib/arAging.js). Prisma Decimals reach the browser as strings ("1.000"),
// so every input goes through Number().

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Kilograms in one case, or null when either part is missing. Never stored.
function kgPerCase(weightPerPackKg, packsPerCase) {
  const w = num(weightPerPackKg);
  const p = num(packsPerCase);
  if (w == null || p == null) return null;
  return Math.round(w * p * 1000) / 1000;
}

// "1 kg/pack · 10 packs/case · 11 pcs/pack", listing only the parts that are set.
function packagingLabel({ weightPerPackKg, packsPerCase, pcsPerPack } = {}) {
  const parts = [];
  if (num(weightPerPackKg) != null) parts.push(`${num(weightPerPackKg)} kg/pack`);
  if (num(packsPerCase) != null) parts.push(`${num(packsPerCase)} packs/case`);
  if (num(pcsPerPack) != null) parts.push(`${num(pcsPerPack)} pcs/pack`);
  return parts.join(' · ');
}

module.exports = { kgPerCase, packagingLabel };
