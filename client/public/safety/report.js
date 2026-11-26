const form = document.querySelector('form');
const button = form.querySelector('button');
const output = document.querySelector('output');
const selector = location.hash.slice(1);
const requestId = crypto.randomUUID();
button.disabled = !/^[\w-]{43}$/.test(selector);
if (button.disabled) output.textContent = 'Open your personal safety URL.';
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  button.disabled = true;
  const fields = new FormData(form);
  const country = fields.get('country').trim().toUpperCase();
  try {
    const response = await fetch('/api/auth/safety/report', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({selector,secret:fields.get('secret'),category:fields.get('category'),requestId,...(country ? {country} : {})}),
    });
    if (!response.ok) throw new Error();
    const {data} = await response.json();
    form.reset();
    output.textContent = 'Recorded: ' + data.status.replaceAll('_',' ').toLowerCase() + '.';
  } catch {
    output.textContent = 'Submission unconfirmed. Check the code and connection, then retry.';
    button.disabled = false;
  }
});
