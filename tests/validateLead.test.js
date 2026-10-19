const { validateLead } = require('../server/utils/validateLead');

describe('validateLead', () => {
  const valid = {
    name: 'Juan Dela Cruz',
    company: 'ABC Trading',
    email: 'juan@abc.ph',
    phone: '0917-123-4567',
    message: 'Interested in a demo for our accounting team.',
    source: 'pricing',
  };

  test('accepts a complete valid lead', () => {
    const r = validateLead(valid);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
    expect(r.data).toEqual(valid);
  });

  test('rejects missing required fields', () => {
    const r = validateLead({});
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveProperty('name');
    expect(r.errors).toHaveProperty('email');
    expect(r.errors).toHaveProperty('message');
  });

  test('rejects malformed email', () => {
    const r = validateLead({ ...valid, email: 'not-an-email' });
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveProperty('email');
  });

  test('trims whitespace and truncates overlong input', () => {
    const r = validateLead({ ...valid, name: `  ${'x'.repeat(300)}  ` });
    expect(r.data.name.length).toBe(100);
  });

  test('nulls empty optionals and defaults source', () => {
    const r = validateLead({ name: 'Ana', email: 'ana@x.ph', message: 'Hi there' });
    expect(r.valid).toBe(true);
    expect(r.data.company).toBeNull();
    expect(r.data.phone).toBeNull();
    expect(r.data.source).toBe('contact');
  });

  test('non-string values are treated as empty', () => {
    const r = validateLead({ name: 123, email: { a: 1 }, message: ['x'] });
    expect(r.valid).toBe(false);
  });
});

describe('validateLead company type', () => {
  const base = { name: 'Juan', email: 'j@x.ph', message: 'Hello' };

  test('known company type is prefixed onto the message', () => {
    const r = validateLead({ ...base, businessType: 'TRADING' });
    expect(r.valid).toBe(true);
    expect(r.data.message).toBe('Company type: Retail / Trading\n\nHello');
  });

  test('unknown company type is ignored', () => {
    const r = validateLead({ ...base, businessType: 'HACKER' });
    expect(r.data.message).toBe('Hello');
  });

  test('empty message is still rejected when a type is given', () => {
    const r = validateLead({ ...base, message: '', businessType: 'SCHOOL' });
    expect(r.valid).toBe(false);
    expect(r.errors.message).toBeDefined();
  });
});
