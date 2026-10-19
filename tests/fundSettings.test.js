jest.mock('../server/config/database', () => ({
  systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
}));

const prisma = require('../server/config/database');
const { DEFAULTS, mergeSettings, sanitize, getFundSettings, saveFundSettings } = require('../server/utils/fundSettings');

beforeEach(() => jest.clearAllMocks());

describe('mergeSettings', () => {
  test('nothing stored gives the defaults', () => {
    expect(mergeSettings(null)).toEqual(DEFAULTS);
    expect(DEFAULTS.marketing).toMatchObject({ enabled: false, percent: 10, accountCode: '1013', sourceAccountCode: '1020', categories: ['ADVERTISING'] });
    expect(DEFAULTS.revolving.accountCodes).toEqual(['1011', '1012']);
  });

  test('stored values override the defaults one by one', () => {
    const m = mergeSettings({ marketing: { enabled: true, percent: 15 } });

    expect(m.marketing).toMatchObject({ enabled: true, percent: 15, accountCode: '1013' });
    expect(m.revolving).toEqual(DEFAULTS.revolving);
  });
});

describe('sanitize', () => {
  test('keeps only valid values and cleans them up', () => {
    const s = sanitize({
      revolving: { accountCodes: [' 1011 ', '1012', ''] },
      marketing: { enabled: 1, percent: '12.345', accountCode: '1013', sourceAccountCode: '1020', categories: [' ADVERTISING ', '', 'EVENTS'] },
    });

    expect(s.revolving.accountCodes).toEqual(['1011', '1012']);
    expect(s.marketing).toMatchObject({ enabled: true, percent: 12.35, categories: ['ADVERTISING', 'EVENTS'] });
  });

  test.each([
    [{ marketing: { percent: -1 } }, 'percent'],
    [{ marketing: { percent: 101 } }, 'percent'],
    [{ marketing: { percent: 'abc' } }, 'percent'],
    [{ marketing: { accountCode: 'ab' } }, 'account'],
    [{ revolving: { accountCodes: [] } }, 'revolving'],
    [{ revolving: { accountCodes: ['x'] } }, 'account'],
    [{ marketing: { categories: 'ADVERTISING' } }, 'categories'],
  ])('rejects %j', (input, msg) => {
    expect(() => sanitize(input)).toThrow(msg);
  });
});

describe('getFundSettings / saveFundSettings', () => {
  test('reads the JSON stored under fundSettings for the business and tolerates garbage', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ marketing: { percent: 20 } }) });
    expect((await getFundSettings(2)).marketing.percent).toBe(20);
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { businessId_key: { businessId: 2, key: 'fundSettings' } } });

    prisma.systemSetting.findUnique.mockResolvedValue({ value: '{not json' });
    expect(await getFundSettings(2)).toEqual(DEFAULTS);

    prisma.systemSetting.findUnique.mockResolvedValue(null);
    expect(await getFundSettings(2)).toEqual(DEFAULTS);
  });

  test('saving validates, merges onto what is stored, and upserts', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ marketing: { percent: 20, categories: ['EVENTS'] } }) });

    const saved = await saveFundSettings(2, { marketing: { enabled: true } });

    expect(saved.marketing).toMatchObject({ enabled: true, percent: 20, categories: ['EVENTS'] });
    const call = prisma.systemSetting.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ businessId_key: { businessId: 2, key: 'fundSettings' } });
    expect(JSON.parse(call.update.value).marketing.enabled).toBe(true);
  });

  test('an invalid save writes nothing', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);

    await expect(saveFundSettings(2, { marketing: { percent: 500 } })).rejects.toThrow('percent');
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  test('the marketing fund account and the source cash account cannot be the same one', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);

    await expect(saveFundSettings(2, { marketing: { accountCode: '1020' } })).rejects.toThrow('different');
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
