// Notification wording lives here. Routine email and SMS text stays discreet: lock screens and shared
// inboxes must not reveal names, places or danger levels. Danger alerts (circle-incident, incident-new)
// deliberately carry the detail people need to act on: who, level, time, note and, where allowed, location.
export type NotificationKind =
  | 'circle-invite' | 'circle-accepted' | 'check-in-request' | 'circle-update'
  | 'welfare-reminder' | 'welfare-concern' | 'welfare-resolved' | 'photo-report' | 'photo-link-spread' | 'incident-new' | 'circle-incident' | 'contact-alert' | 'public-report';

export interface Rendered {
  title:string; body:string; link:string; priority:'normal'|'emergency';
  /** Channels beyond in-app this kind may use, subject to the recipient's preferences. */
  external:('email'|'sms')[];
  subject:string; text:string;
}

const discreet = 'You have a new notification in Sariel. Sign in to view it.';
const urgent = 'Someone in your Sariel circle may need you. Sign in to Sariel now.';

// Email/SMS body for danger alerts: everything needed to act, in one short message.
function alertText(data:Record<string, string>, action = 'Open Sariel and try contacting them now.') {
  return [`Sariel alert: ${data.name ?? 'Someone'} reported ${data.level ?? 'danger'}${data.time ? ` at ${data.time}` : ''}.`,
    data.note ? `Note: “${data.note}”.` : '', data.map ? `Location (${data.mapSource}): ${data.map}` : '', action].filter(Boolean).join(' ');
}

export function render(kind:NotificationKind, data:Record<string, string>): Rendered {
  const name = data.name ?? 'Someone';
  switch (kind) {
    case 'circle-invite': return {title:`${name} invited you to their circle`, body:'Accept to see what they share with you.',
      link:'/circle?tab=invites', priority:'normal', external:['email'], subject:'New Sariel invitation', text:discreet};
    case 'circle-accepted': return {title:`${name} joined your circle`, body:'They can now see what you chose to share.',
      link:'/circle', priority:'normal', external:['email'], subject:'Sariel circle update', text:discreet};
    case 'check-in-request': return {title:`${name} asked you to check in`, body:'Let them know you’re OK.',
      link:'/circle', priority:'normal', external:['email', 'sms'], subject:'Sariel check-in request', text:discreet};
    case 'circle-update': return {title:`${name} posted an update`, body:data.text ?? '',
      link:'/circle', priority:'normal', external:[], subject:'', text:''};
    case 'welfare-reminder': return {title:'Time to check in', body:'Your scheduled check-in is due. Tap “I’m OK” to let your circle know.',
      link:'/dashboard', priority:'normal', external:['email', 'sms'], subject:'Sariel check-in reminder', text:'Your Sariel check-in is due. Sign in to check in.'};
    case 'welfare-concern': return {title:`${name} missed a check-in`, body:data.detail ?? 'Their status is now Unknown. Try contacting them.',
      link:'/circle', priority:'emergency', external:['email', 'sms'], subject:'Please check on someone in your Sariel circle', text:urgent};
    case 'photo-report': return {title:`${name} may need help`, body:`They sent a Sariel report photo. Their safety status has changed.${data.note ? ` They wrote: “${data.note}”.` : ''} Try contacting them now.`,
      link:'/circle', priority:'emergency', external:['email', 'sms'], subject:'Please check on someone in your Sariel circle', text:urgent};
    case 'photo-link-spread': return {title:`${name}’s report link was opened by several people`, body:'Their report photo link has now been opened by at least 3 different people. Please check on them.',
      link:'/circle', priority:'emergency', external:['email', 'sms'], subject:'Please check on someone in your Sariel circle', text:urgent};
    case 'circle-incident': return {title:`${name} reported: ${data.level ?? 'needs help'}`,
      body:`${data.time ? `Reported ${data.time}. ` : ''}${data.note ? `They wrote: “${data.note}”. ` : ''}${data.map ? `Location (${data.mapSource}): ${data.map} ` : ''}Try contacting them now.`,
      link:'/circle', priority:'emergency', external:['email', 'sms'], subject:`Sariel alert: ${name} reported ${data.level ?? 'danger'}`, text:alertText(data)};
    case 'contact-alert': return {title:`${name} may need help`, body:`${name} listed you as an emergency contact. ${data.detail ?? ''} Try contacting them now.`.trim(),
      link:'/notifications', priority:'emergency', external:['email', 'sms'], subject:'Someone who trusts you may need help', text:'Someone who listed you as an emergency contact on Sariel may need help. Sign in to Sariel to see details.'};
    case 'public-report': return {title:`Public report from ${data.country ?? 'unknown country'}${data.urgency === 'urgent' ? ' · urgent' : ''}`,
      body:`${data.summary ?? ''}${data.media && data.media !== '0' ? ` · ${data.media} file(s) attached` : ''}`, link:'/admin/public-reports',
      priority:data.urgency === 'urgent' ? 'emergency' : 'normal', external:['email'], subject:'A new public report needs review in Sariel',
      text:'Someone submitted a public report in Sariel. Sign in to the admin console to review it.'};
    case 'incident-new': return {title:`New incident: ${data.level ?? 'Report'}`,
      body:`${name} · ${data.channel ?? 'Report'} · ${data.category ?? 'welfare'}${data.time ? ` · ${data.time}` : ''}${data.note ? ` · “${data.note}”` : ''}${data.map ? ` · Location (${data.mapSource}): ${data.map}` : ''}`,
      link:'/admin/incidents', priority:'emergency', external:['email', 'sms'], subject:`Sariel incident: ${data.level ?? 'Report'} reported by ${name}`, text:alertText(data, 'Review it in the Sariel admin console.')};
    case 'welfare-resolved': return {title:`${name} checked in`, body:'They confirmed they’re OK.',
      link:'/circle', priority:'normal', external:['email'], subject:'Sariel circle update', text:discreet};
  }
}
