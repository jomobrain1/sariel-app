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

export async function sendEmail(to:string, subject:string, text:string, idempotencyKey:string) {
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const fromName = process.env.MAIL_FROM_NAME || 'Sariel';
  const from = process.env.MAIL_FROM || process.env.MAIL_USER!.trim();
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#14231f">
  <p style="font-weight:800;font-size:18px;margin:0 0 16px">SARIEL</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 20px">${escape(text)}</p>
  <a href="${escape(appUrl)}" style="display:inline-block;background:#0f4d3f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">Open Sariel</a>
  <p style="font-size:12px;color:#5b6b66;margin:24px 0 0">You receive this because of your Sariel notification settings.</p></div>`;
  await transport().sendMail({from:`"${fromName.replace(/"/g, '')}" <${from}>`, to, subject, text:`${text}\n\n${appUrl}`, html,
    headers:{'X-Entity-Ref-ID':idempotencyKey}});
}

/** SMTP failures that won't fix themselves (bad login, rejected address) shouldn't be retried. */
export function permanentSmtpError(error:unknown) {
  const code = (error as {responseCode?:number; code?:string})?.responseCode;
  const kind = (error as {code?:string})?.code;
  return kind === 'EAUTH' || kind === 'EENVELOPE' || (typeof code === 'number' && code >= 500 && code < 600);
}
