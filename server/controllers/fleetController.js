const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// Drivers and Vehicles: the two cost tags that can be put on expense lines.
// Records are never deleted, only deactivated, because tagged journal lines keep
// pointing at them.

const text = (v, label, { max, required }) => {
  const s = String(v ?? '').trim();
  if (!s) {
    if (required) throw createError(`The ${label} is required`, 400);
    return null;
  }
  if (s.length > max) throw createError(`The ${label} must be ${max} characters or fewer`, 400);
  return s;
};

const KINDS = {
  driver: {
    model: 'driver', label: 'Driver',
    read: (b, partial) => {
      const out = {};
      if (!partial || b.code !== undefined) out.code = text(b.code, 'code', { max: 30, required: true });
      if (!partial || b.name !== undefined) out.name = text(b.name, 'name', { max: 100, required: true });
      return out;
    },
  },
  vehicle: {
    model: 'vehicle', label: 'Vehicle',
    read: (b, partial) => {
      const out = {};
      if (!partial || b.code !== undefined) out.code = text(b.code, 'code', { max: 30, required: true });
      if (!partial || b.description !== undefined) out.description = text(b.description, 'description', { max: 150, required: false });
      return out;
    },
  },
};

const list = (kind) => async (req, res, next) => {
  try {
    const where = { businessId: req.businessId };
    if (req.query.active !== undefined) where.isActive = req.query.active === 'true';
    res.json(await prisma[KINDS[kind].model].findMany({ where, orderBy: { code: 'asc' } }));
  } catch (err) { next(err); }
};

const create = (kind) => async (req, res, next) => {
  try {
    const { model, label, read } = KINDS[kind];
    const data = read(req.body, false);
    try {
      res.status(201).json(await prisma[model].create({ data: { businessId: req.businessId, ...data } }));
    } catch (err) {
      if (err.code === 'P2002') throw createError(`A ${label.toLowerCase()} with that code already exists`, 409);
      throw err;
    }
  } catch (err) { next(err); }
};

const update = (kind) => async (req, res, next) => {
  try {
    const { model, label, read } = KINDS[kind];
    const id = Number(req.params.id);
    const found = await prisma[model].findFirst({ where: { id, businessId: req.businessId } });
    if (!found) throw createError(`${label} not found`, 404);
    const data = read(req.body, true);
    if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
    try {
      res.json(await prisma[model].update({ where: { id }, data }));
    } catch (err) {
      if (err.code === 'P2002') throw createError(`A ${label.toLowerCase()} with that code already exists`, 409);
      throw err;
    }
  } catch (err) { next(err); }
};

exports.listDrivers   = list('driver');
exports.createDriver  = create('driver');
exports.updateDriver  = update('driver');
exports.listVehicles  = list('vehicle');
exports.createVehicle = create('vehicle');
exports.updateVehicle = update('vehicle');
