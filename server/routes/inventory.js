const router = require('express').Router();
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const c = require('../controllers/inventoryController');
const pkg = require('../controllers/packageController');

router.use(authenticate, resolveBusiness);

// ── Categories ────────────────────────────────────────────────
router.get   ('/categories',        c.listCategories);
router.post  ('/categories',        authorize('ADMIN','MANAGER','ACCOUNTANT'), c.createCategory);
router.put   ('/categories/:id',    authorize('ADMIN','MANAGER','ACCOUNTANT'), c.updateCategory);
router.delete('/categories/:id',    authorize('ADMIN','MANAGER'),              c.deleteCategory);

// ── Reports (before /:id to avoid clash) ─────────────────────
router.get('/reports/stock-on-hand',     c.stockOnHand);
router.get('/reports/valuation',         c.valuationReport);
router.get('/reports/low-stock',         c.lowStockReport);
router.get('/reports/movement-summary',  c.movementSummary);

// ── Packages (before /:id) ────────────────────────────────────
router.get   ('/packages',      pkg.list);
router.get   ('/packages/:id',  pkg.get);
router.post  ('/packages',      authorize('ADMIN','MANAGER','ACCOUNTANT'), pkg.create);
router.put   ('/packages/:id',  authorize('ADMIN','MANAGER','ACCOUNTANT'), pkg.update);
router.delete('/packages/:id',  authorize('ADMIN','MANAGER'),              pkg.remove);

// ── Transactions ──────────────────────────────────────────────
router.get ('/transactions',    c.listTransactions);
router.post('/transactions',    authorize('ADMIN','MANAGER','ACCOUNTANT'), c.createTransaction);

// ── Items ─────────────────────────────────────────────────────
router.get   ('/',      c.listItems);
router.post  ('/',      authorize('ADMIN','MANAGER','ACCOUNTANT'), c.createItem);
router.get   ('/:id',   c.getItem);
router.put   ('/:id',   authorize('ADMIN','MANAGER','ACCOUNTANT'), c.updateItem);
router.delete('/:id',   authorize('ADMIN','MANAGER'),              c.deleteItem);

module.exports = router;
