process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'user@test.local';
process.env.SMTP_PASS = 'secret';

jest.mock('nodemailer');

const mailer = require('../server/utils/mailer');
const nodemailer = require('nodemailer');

const sendMailMock = jest.fn().mockResolvedValue({});
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const business = { id: 3, name: 'New Client Co.', code: 'NCC', email: 'client@newclient.ph' };

beforeEach(() => sendMailMock.mockClear());

describe('mailer.sendLicensePendingNotice', () => {
  test('emails every super admin recipient', async () => {
    await mailer.sendLicensePendingNotice(business, { name: 'Juan Dela Cruz', email: 'juan@finara.ph' }, ['super1@finara.ph', 'super2@finara.ph']);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls.map((c) => c[0].to)).toEqual(['super1@finara.ph', 'super2@finara.ph']);
    expect(sendMailMock.mock.calls[0][0].subject).toBe('New business pending license — New Client Co.');
  });

  test('returns false and sends nothing when there are no super admin recipients', async () => {
    const result = await mailer.sendLicensePendingNotice(business, { name: 'Juan' }, []);
    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('escapes the business name and requester name in the HTML body', async () => {
    const evilBusiness = { ...business, name: '<script>alert(1)</script>' };
    await mailer.sendLicensePendingNotice(evilBusiness, { name: '<img src=x onerror=alert(1)>' }, ['super1@finara.ph']);
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });
});

describe('mailer.sendLicenseActivatedNotice', () => {
  test('emails the requester and the business contact email', async () => {
    await mailer.sendLicenseActivatedNotice(business, { email: 'requester@finara.ph', firstName: 'Ana' });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock.mock.calls.map((c) => c[0].to).sort()).toEqual(['client@newclient.ph', 'requester@finara.ph'].sort());
  });

  test('deduplicates when requester email equals business email', async () => {
    await mailer.sendLicenseActivatedNotice(business, { email: 'client@newclient.ph' });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  test('returns false when there is no requester and no business email', async () => {
    const result = await mailer.sendLicenseActivatedNotice({ ...business, email: null }, null);
    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('mailer.sendLicenseSuspendedNotice', () => {
  test('emails the requester with a suspension notice', async () => {
    await mailer.sendLicenseSuspendedNotice(business, { email: 'requester@finara.ph' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'requester@finara.ph',
      subject: 'Your Finara license has been suspended — New Client Co.',
    }));
  });
});
