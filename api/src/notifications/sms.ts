// SMS through Mobile Sasa (https://api.mobilesasa.com). Plain HTTP: Bearer token + JSON body.
// New Mobile Sasa accounts can only text the account owner's own number until full sender access is approved.
export const smsConfigured = () => !!process.env.MOBILESASA_TOKEN?.trim();

export class SmsError extends Error {
  constructor(message:string, readonly retryable:boolean) { super(message); }
}

/** Mobile Sasa takes numbers without the leading "+" (e.g. 254712345678 or 0712345678). */
export const smsNumber = (phone:string) => phone.replace(/[\s-]/g, '').replace(/^\+/, '');

export async function sendSms(phone:string, message:string) {
  const base = (process.env.MOBILESASA_BASE_URL || 'https://api.mobilesasa.com').replace(/\/$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/v1/send/message`, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15_000),
      headers:{Authorization:'Bearer ' + process.env.MOBILESASA_TOKEN!.trim(), 'Content-Type':'application/json', Accept:'application/json'},
      body:JSON.stringify({senderID:process.env.MOBILESASA_SENDER_ID?.trim() || 'MOBILESASA', phone:smsNumber(phone), message:message.slice(0, 459)})});
  } catch (error) {
    throw new SmsError('Mobile Sasa could not be reached: ' + (error instanceof Error ? error.message : 'network error'), true);
  }
  const text = await response.text();
  let body: {status?:boolean; message?:string; responseCode?:string} = {};
  try { body = JSON.parse(text); } catch { /* Not JSON. */ }
  if (!response.ok) throw new SmsError(`Mobile Sasa responded ${response.status}${body.message ? ': ' + body.message.slice(0, 160) : ''}`,
    response.status === 429 || response.status >= 500);
  // Mobile Sasa can answer 200 with status:false (e.g. insufficient balance or an unapproved recipient).
  if (body.status === false) throw new SmsError('Mobile Sasa rejected the message' + (body.message ? ': ' + body.message.slice(0, 160) : ''), false);
}
