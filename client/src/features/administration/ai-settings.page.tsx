import { useState, type FormEvent } from 'react';
import { aiApi, type AiSettings, type Capability, type Choice } from './ai.api';
import './ai-settings.css';

const capabilities: { key: Capability; title: string; about: string }[] = [
  { key: 'chat', title: 'Assistant and legal answers', about: 'Conversations, tool use and cited legal answers.' },
  { key: 'embeddings', title: 'Legal search', about: 'Turns legal passages into vectors for search by meaning. Changing it requires re-indexing documents.' },
  { key: 'images', title: 'Image generation', about: 'Creates ordinary cover photos from fixed themes. No safety details are ever sent.' },
];
const number = new Intl.NumberFormat();

function KeyRow({ provider, data }: { provider: AiSettings['providers'][number]; data: AiSettings }) {
  const [save, saving] = aiApi.useSaveAiKeyMutation();
  const [remove, removing] = aiApi.useRemoveAiKeyMutation();
  const [value, setValue] = useState('');
  const key = data.keys[provider.id];
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await save({ provider: provider.id, apiKey: value.trim() }).unwrap(); setValue(''); } catch { /* Shown below. */ }
  }
  return <li className="ai-key">
    <div className="ai-key-head"><strong>{provider.label}</strong>
      <span className={'ai-pill' + (key.configured ? ' is-on' : '')}>{key.configured ? `Connected ${key.hint}` : 'No key'}</span></div>
    <small>{key.source === 'env' ? `Using ${provider.env} from the server environment.` : key.source === 'stored' ? 'Stored encrypted. Never shown again.' : `Paste a key, or set ${provider.env} on the server.`}
      {' '}Offers: {provider.capabilities.join(', ')}.</small>
    <form onSubmit={submit}>
      <input type="password" autoComplete="off" placeholder={key.configured ? 'Replace key' : 'Paste API key'} value={value} onChange={e => setValue(e.target.value)} aria-label={`${provider.label} API key`} />
      <button className="ai-primary" disabled={saving.isLoading || value.trim().length < 8}>Save</button>
      {key.source === 'stored' && <button type="button" className="ai-ghost" disabled={removing.isLoading} onClick={() => void remove(provider.id)}>Remove</button>}
    </form>
    {saving.isError && <p role="alert" className="ai-error">Couldn’t save the key.</p>}
  </li>;
}

function CapabilityCard({ capability, choice, data, onChange }: { capability: typeof capabilities[number]; choice: Choice; data: AiSettings; onChange: (c: Choice) => void }) {
  const [test, testing] = aiApi.useTestAiMutation();
  const options = data.providers.filter(p => p.capabilities.includes(capability.key));
  const suggestions = data.providers.find(p => p.id === choice.provider)?.models[capability.key] ?? [];
  const result = testing.data?.data;
  const listId = 'models-' + capability.key;
  return <section className="ai-card">
    <h3>{capability.title}</h3>
    <p>{capability.about}</p>
    <div className="ai-fields">
      <label>Provider<select value={choice.provider} onChange={e => onChange({ provider: e.target.value, model: data.providers.find(p => p.id === e.target.value)?.models[capability.key]?.[0] ?? '' })}>
        {options.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label>Model<input list={listId} value={choice.model} onChange={e => onChange({ ...choice, model: e.target.value })} spellCheck={false} />
        <datalist id={listId}>{suggestions.map(m => <option key={m} value={m} />)}</datalist></label>
    </div>
    <div className="ai-test">
      <button type="button" className="ai-ghost" disabled={testing.isLoading} onClick={() => void test(capability.key)}>{testing.isLoading ? 'Testing…' : 'Test saved settings'}</button>
      {result && <span className={result.ok ? 'ai-ok' : 'ai-error'} role="status">{result.ok ? '✓ Working' : '✕ Failed'} · {result.latencyMs} ms · {result.detail}</span>}
    </div>
  </section>;
}

function Usage() {
  const [days, setDays] = useState(30);
  const usage = aiApi.useAiUsageQuery(days);
  const data = usage.currentData?.data;
  const total = data?.byCapability.reduce((sum, r) => sum + r.requests, 0) ?? 0;
  return <section className="ai-panel">
    <header><div><h2>Usage</h2><p>Requests, failures and tokens by feature.</p></div>
      <select aria-label="Period" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}</select></header>
    {!data ? <p role="status">Loading…</p> : <>
      <div className="ai-stats"><div><strong>{number.format(total)}</strong><span>Requests</span></div><div><strong>{number.format(data.people)}</strong><span>People using AI</span></div>
        <div><strong>{number.format(data.byCapability.reduce((s, r) => s + r.failures, 0))}</strong><span>Failures</span></div></div>
      {data.byCapability.length ? <table className="ai-table"><thead><tr><th>Feature</th><th>Provider · model</th><th>Requests</th><th>Failures</th><th>Input tokens</th><th>Output tokens</th></tr></thead>
        <tbody>{data.byCapability.map(r => <tr key={r.capability + r.provider + r.model}><td>{capabilities.find(c => c.key === r.capability)?.title}</td><td>{r.provider} · {r.model}</td>
          <td>{number.format(r.requests)}</td><td>{number.format(r.failures)}</td><td>{number.format(r.input)}</td><td>{number.format(r.output)}</td></tr>)}</tbody></table>
        : <p className="ai-muted">No AI requests in this period.</p>}
    </>}
  </section>;
}

export function AiSettingsPage() {
  const settings = aiApi.useAiSettingsQuery();
  const [save, saving] = aiApi.useSaveAiSettingsMutation();
  const [draft, setDraft] = useState<Pick<AiSettings, Capability | 'dailyLimit'> | null>(null);
  const [saved, setSaved] = useState(false);
  const data = settings.currentData?.data;
  if (settings.isError) return <section className="ai-admin"><p role="alert">Couldn’t load AI settings.</p></section>;
  if (!data) return <section className="ai-admin"><p role="status">Loading…</p></section>;
  const form = draft ?? { chat: data.chat, embeddings: data.embeddings, images: data.images, dailyLimit: data.dailyLimit };
  const change = (next: Partial<typeof form>) => { setSaved(false); setDraft({ ...form, ...next }); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await save(form).unwrap(); setDraft(null); setSaved(true); } catch { /* Shown below. */ }
  }
  return <section className="ai-admin" aria-labelledby="ai-title">
    <header className="ai-head"><h1 id="ai-title">AI providers</h1><p>Choose which provider powers each feature. Changes apply immediately.</p></header>
    <section className="ai-panel"><header><div><h2>API keys</h2><p>Each provider is billed to the account that owns its key.</p></div></header>
      <ul className="ai-keys">{data.providers.map(p => <KeyRow key={p.id} provider={p} data={data} />)}</ul></section>
    <form className="ai-panel" onSubmit={submit}>
      <header><div><h2>Features</h2><p>Save changes, then use Test to confirm each one works.</p></div></header>
      <div className="ai-cards">{capabilities.map(c => <CapabilityCard key={c.key} capability={c} choice={form[c.key]} data={data} onChange={choice => change({ [c.key]: choice })} />)}</div>
      <label className="ai-limit">Daily AI requests per person<input type="number" min={1} max={10000} value={form.dailyLimit} onChange={e => change({ dailyLimit: Number(e.target.value) })} /></label>
      <div className="ai-actions"><button className="ai-primary" disabled={saving.isLoading || !draft}>{saving.isLoading ? 'Saving…' : 'Save changes'}</button>
        {draft && <button type="button" className="ai-ghost" onClick={() => setDraft(null)}>Discard</button>}
        {saved && <span className="ai-ok" role="status">Saved.</span>}
        {saving.isError && <span className="ai-error" role="alert">Couldn’t save. Check each provider supports its feature.</span>}</div>
    </form>
    <Usage />
  </section>;
}
