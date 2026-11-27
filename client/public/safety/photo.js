import { landscape } from './landscape.js';

// Private report-photo link. Visitors see an ordinary photo page; opening it tells Sariel quietly.
const token = location.pathname.match(/^\/p\/([A-Za-z0-9_-]{12})\/?$/)?.[1];
const scenes = ['valley', 'sunrise', 'harbor', 'road', 'bridge', 'mountain'];
const scene = scenes[[...(token ?? 'x')].reduce((sum, c) => sum + c.charCodeAt(0), 0) % scenes.length];
document.title = 'Photo';
const style = document.createElement('style');
style.textContent = 'body{margin:0;font-family:system-ui,sans-serif;background:#f4f2ee;color:#2b2b2b}main{max-width:820px;margin:0 auto;padding:32px 16px}figure{margin:0;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 14px #0001}canvas{display:block;width:100%;height:auto}figcaption{padding:14px 18px;color:#6b6b6b;font-size:.95rem}';
document.head.append(style);
const root = document.querySelector('#root') ?? document.body;
const main = document.createElement('main');
const figure = document.createElement('figure');
const caption = document.createElement('figcaption');
caption.textContent = 'A view worth sharing.';
figure.append(landscape(scene), caption);
main.append(figure);
root.replaceChildren(main);
if (token && !document.prerendering) {
  fetch('/api/auth/safety/photo-link', { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).catch(() => {});
}
