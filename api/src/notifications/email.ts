import nodemailer, { type Transporter } from 'nodemailer';

// Sends notification emails over SMTP using the same MAIL_* settings as password resets.
// Message text is already discreet (see templates.ts); this only adds a plain branded wrapper.
let cached: {key:string; transport:Transporter} | undefined;

export function smtpConfigured() {
  return !!(process.env.MAIL_USER?.trim() && process.env.MAIL_PASS?.trim());
}

function transport(): Transporter {
  const port = Number(process.env.MAIL_PORT || 465);
  const settings = {
    host:process.env.MAIL_HOST || 'smtp.gmail.com', port,
    secure:process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : port === 465,
    auth:{user:process.env.MAIL_USER!.trim(), pass:process.env.MAIL_PASS!.replace(/\s+/g, '')},
    connectionTimeout:10_000, greetingTimeout:10_000, socketTimeout:15_000,
  };
  const key = JSON.stringify(settings);
  if (cached?.key !== key) cached = {key, transport:nodemailer.createTransport(settings)};
  return cached.transport;
}

const escape = (value:string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));

// Splits a notification body into readable lines: "A · B · C" lists, or sentences.
function lines(text:string) {
  const parts = text.includes(' · ') ? text.split(' · ') : text.split(/(?<=[.!?”])\s+(?=[A-Z“])/);
  return parts.map(part => part.trim()).filter(Boolean);
}
const urlPattern = /https?:\/\/[^\s<>"”]+/g;
// One line of the message: plain text, with links shown as buttons ("Open in Maps" for map links).
function line(text:string) {
  const urls = text.match(urlPattern) ?? [];
  const label = escape(text.replace(urlPattern, '').replace(/[:\s]+$/, '').trim());
  const links = urls.map(url => `<a href="${escape(url)}" style="display:inline-block;margin-top:6px;color:#0f4d3f;font-weight:700;text-decoration:underline">${/maps\.google\./.test(url) ? 'Open in Maps' : 'Open link'} &rarr;</a>`).join(' ');
  return `<tr><td style="padding:10px 0;border-top:1px solid #e3ebe7;font-size:15px;line-height:1.5;color:#14231f">${label}${label && links ? '<br>' : ''}${links}</td></tr>`;
}

export async function sendEmail(to:string, subject:string, text:string, idempotencyKey:string, link?:string) {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const target = link?.startsWith('/') ? appUrl + link : appUrl;
  const fromName = process.env.MAIL_FROM_NAME || 'Sariel';
  const from = process.env.MAIL_FROM || process.env.MAIL_USER!.trim();
  const body = lines(text).map(line).join('').replace('border-top:1px solid #e3ebe7;', '');
  // Table layout with inline styles: renders consistently in Gmail, Outlook and phone mail apps.
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef3f0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f0;padding:24px 12px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dce6e1">
    <tr><td style="background:#0f4d3f;padding:18px 24px;color:#ffffff;font-weight:800;font-size:18px;letter-spacing:.06em">&#128737;&#65039; SARIEL</td></tr>
    <tr><td style="padding:24px 24px 8px"><h1 style="margin:0;font-size:20px;line-height:1.3;color:#14231f">${escape(subject)}</h1></td></tr>
    <tr><td style="padding:8px 24px 4px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f8f6;border:1px solid #dce6e1;border-left:4px solid #0f4d3f;border-radius:10px">
        <tr><td style="padding:6px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:20px 24px 24px"><a href="${escape(target)}" style="display:inline-block;background:#0f4d3f;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700;font-size:15px">Open Sariel</a></td></tr>
    <tr><td style="padding:16px 24px;background:#f7faf8;border-top:1px solid #e3ebe7;font-size:12px;line-height:1.5;color:#5b6b66">You receive this because of your Sariel notification settings. If someone may be in immediate danger, also contact local emergency services.</td></tr>
  </table>
</td></tr></table></body></html>`;
  await transport().sendMail({from:`"${fromName.replace(/"/g, '')}" <${from}>`, to, subject, text:`${subject}\n\n${lines(text).join('\n')}\n\n${target}`, html,
    headers:{'X-Entity-Ref-ID':idempotencyKey}});
}

/** SMTP failures that won't fix themselves (bad login, rejected address) shouldn't be retried. */
export function permanentSmtpError(error:unknown) {
  const code = (error as {responseCode?:number; code?:string})?.responseCode;
  const kind = (error as {code?:string})?.code;
  return kind === 'EAUTH' || kind === 'EENVELOPE' || (typeof code === 'number' && code >= 500 && code < 600);
}
