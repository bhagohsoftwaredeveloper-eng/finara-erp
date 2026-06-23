const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding PH-ERP database...');

  // ─── Admin User ────────────────────────────────────────────
  const hashedPw = await bcrypt.hash('Admin@123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ph-erp.com' },
    update: {},
    create: {
      email: 'admin@ph-erp.com',
      password: hashedPw,
      firstName: 'System',
      lastName: 'Administrator',
      role: 'ADMIN',
    },
  });
  console.log(`✅ Admin user: ${admin.email} / Admin@123`);

  // ─── Chart of Accounts (PFRS-aligned) ─────────────────────
  const accounts = [
    // ASSETS
    { accountCode:'1000', accountName:'Current Assets',                 accountType:'ASSET',     normalBalance:'DEBIT' },
    { accountCode:'1010', accountName:'Cash on Hand',                   accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1020', accountName:'Cash in Bank — BDO',             accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1030', accountName:'Cash in Bank — BPI',             accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1100', accountName:'Accounts Receivable — Trade',    accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1110', accountName:'Allowance for Doubtful Accounts',accountType:'ASSET',     normalBalance:'CREDIT',parentCode:'1000' },
    { accountCode:'1200', accountName:'Inventories',                    accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1300', accountName:'Prepaid Expenses',               accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1310', accountName:'Input VAT',                      accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1320', accountName:'Prepaid Income Tax',             accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1000' },
    { accountCode:'1500', accountName:'Non-Current Assets',             accountType:'ASSET',     normalBalance:'DEBIT' },
    { accountCode:'1510', accountName:'Property, Plant & Equipment',    accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1500' },
    { accountCode:'1520', accountName:'Accumulated Depreciation',       accountType:'ASSET',     normalBalance:'CREDIT',parentCode:'1500' },
    { accountCode:'1530', accountName:'Intangible Assets',              accountType:'ASSET',     normalBalance:'DEBIT', parentCode:'1500' },
    // LIABILITIES
    { accountCode:'2000', accountName:'Current Liabilities',            accountType:'LIABILITY', normalBalance:'CREDIT' },
    { accountCode:'2010', accountName:'Accounts Payable — Trade',       accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2020', accountName:'Accrued Expenses',               accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2030', accountName:'Output VAT Payable',             accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2040', accountName:'Withholding Tax Payable',        accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2050', accountName:'SSS Contributions Payable',      accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2060', accountName:'PhilHealth Contributions Payable',accountType:'LIABILITY',normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2070', accountName:'Pag-IBIG Contributions Payable', accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2080', accountName:'Income Tax Payable',             accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2100', accountName:'Non-Current Liabilities',        accountType:'LIABILITY', normalBalance:'CREDIT' },
    { accountCode:'2110', accountName:'Loans Payable — Long Term',      accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2100' },
    // EQUITY
    { accountCode:'3000', accountName:'Equity',                         accountType:'EQUITY',    normalBalance:'CREDIT' },
    { accountCode:'3010', accountName:'Share Capital / Owner\'s Capital',accountType:'EQUITY',   normalBalance:'CREDIT', parentCode:'3000' },
    { accountCode:'3020', accountName:'Retained Earnings',              accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
    { accountCode:'3030', accountName:'Current Year Earnings',          accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
    // REVENUE
    { accountCode:'4000', accountName:'Revenue',                        accountType:'REVENUE',   normalBalance:'CREDIT' },
    { accountCode:'4010', accountName:'Sales — Goods',                  accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    { accountCode:'4020', accountName:'Sales — Services',               accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    { accountCode:'4030', accountName:'Other Income',                   accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    { accountCode:'4040', accountName:'Interest Income',                accountType:'REVENUE',   normalBalance:'CREDIT', parentCode:'4000' },
    // EXPENSES
    { accountCode:'5000', accountName:'Cost of Sales',                  accountType:'EXPENSE',   normalBalance:'DEBIT' },
    { accountCode:'5010', accountName:'Cost of Goods Sold',             accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5000' },
    { accountCode:'5020', accountName:'Cost of Services Rendered',      accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5000' },
    { accountCode:'5100', accountName:'Operating Expenses',             accountType:'EXPENSE',   normalBalance:'DEBIT' },
    { accountCode:'5110', accountName:'Salaries and Wages',             accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5120', accountName:'SSS — Employer Share',           accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5130', accountName:'PhilHealth — Employer Share',    accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5140', accountName:'Pag-IBIG — Employer Share',      accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5150', accountName:'Rent Expense',                   accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5160', accountName:'Utilities Expense',              accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5170', accountName:'Communications Expense',         accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5180', accountName:'Office Supplies Expense',        accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5190', accountName:'Depreciation Expense',           accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5200', accountName:'Professional Fees',              accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5210', accountName:'Representation Expense',         accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5220', accountName:'Transportation Expense',         accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5230', accountName:'Marketing & Advertising',        accountType:'EXPENSE',   normalBalance:'DEBIT', parentCode:'5100' },
    { accountCode:'5900', accountName:'Income Tax Expense',             accountType:'EXPENSE',   normalBalance:'DEBIT' },
  ];

  // Build code→id map
  const codeMap = {};
  for (const acct of accounts) {
    const created = await prisma.account.upsert({
      where: { accountCode: acct.accountCode },
      update: {},
      create: {
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        accountType: acct.accountType,
        normalBalance: acct.normalBalance,
        parentId: acct.parentCode ? codeMap[acct.parentCode] : null,
      },
    });
    codeMap[acct.accountCode] = created.id;
  }
  console.log(`✅ ${accounts.length} accounts seeded`);

  // ─── Sample Vendor ─────────────────────────────────────────
  await prisma.vendor.upsert({
    where: { vendorCode: 'VEN-001' },
    update: {},
    create: {
      vendorCode: 'VEN-001', name: 'ABC Office Supplies Inc.',
      tin: '123-456-789-000', address: 'Makati City, Metro Manila',
      contactName: 'Juan Cruz', email: 'abc@supplier.com', phone: '02-1234-5678',
    },
  });

  // ─── Sample Customer ───────────────────────────────────────
  await prisma.customer.upsert({
    where: { customerCode: 'CUS-001' },
    update: {},
    create: {
      customerCode: 'CUS-001', name: 'XYZ Corporation',
      tin: '987-654-321-000', address: 'BGC, Taguig, Metro Manila',
      contactName: 'Maria Santos', email: 'xyz@client.com', phone: '02-9876-5432',
    },
  });

  // ─── Sample Employee ───────────────────────────────────────
  await prisma.employee.upsert({
    where: { employeeNo: 'EMP-001' },
    update: {},
    create: {
      employeeNo: 'EMP-001', firstName: 'Juan', lastName: 'dela Cruz', middleName: 'B.',
      position: 'Accountant', department: 'Finance',
      tin: '111-222-333-000', sssNo: '33-1234567-8', philhealthNo: '01-234567890-1', pagibigNo: '1234-5678-9012',
      hireDate: new Date('2022-01-15'),
      employmentType: 'REGULAR', payFrequency: 'SEMI_MONTHLY',
      basicSalary: 35000,
    },
  });

  console.log('✅ Sample vendor, customer, and employee seeded');
  console.log('\n🎉 Database seeded successfully!');
  console.log('📋 Login: admin@ph-erp.com / Admin@123');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
