import { useState, type FormEvent, type ReactNode } from 'react';
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
  const [makeDefault, defaulting] = aiApi.useDefaultAiKeyMutation();
  const [remove, removing] = aiApi.useRemoveAiKeyMutation();
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const key = data.keys[provider.id];
  const full = key.list.length >= data.limits.keys;
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await save({ provider: provider.id, apiKey: value.trim(), ...(label.trim() ? { label: label.trim() } : {}) }).unwrap(); setValue(''); setLabel(''); } catch { /* Shown below. */ }
  }
  return <li className="ai-key">
    <div className="ai-key-head"><strong>{provider.label}</strong>
      <span className={'ai-pill' + (key.configured ? ' is-on' : '')}>{key.configured ? `${key.list.length + (key.env ? 1 : 0)} key${key.list.length + (key.env ? 1 : 0) === 1 ? '' : 's'}` : 'No key'}</span></div>
    <small>Offers: {provider.capabilities.join(', ')}. If the default key fails (quota, invalid, busy), the next key is tried automatically.</small>
    {(!!key.list.length || key.env) && <ul className="ai-keylist">
      {key.list.map(k => <li key={k.id}>
        <span><strong>{k.label}</strong> <code>{k.hint}</code>{k.default && <em className="ai-pill is-on">Default</em>}</span>
        <span className="ai-keyactions">
          {!k.default && <button type="button" className="ai-ghost" disabled={defaulting.isLoading} onClick={() => void makeDefault({ provider: provider.id, id: k.id })}>Make default</button>}
          <button type="button" className="ai-ghost is-danger" disabled={removing.isLoading} onClick={() => { if (confirm(`Remove ${k.label}?`)) void remove({ provider: provider.id, id: k.id }); }}>Remove</button>
        </span></li>)}
      {key.env && <li><span><strong>{provider.env}</strong> <code>{key.env}</code><em className="ai-pill">Server environment · tried last</em></span></li>}
    </ul>}
    {full ? <small>Maximum of {data.limits.keys} saved keys reached.</small> : <form onSubmit={submit}>
      <input className="ai-keylabel" placeholder="Label (optional)" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} aria-label={`${provider.label} key label`} />
      <input type="password" autoComplete="off" placeholder={key.list.length ? 'Add another key' : 'Paste API key'} value={value} onChange={e => setValue(e.target.value)} aria-label={`${provider.label} API key`} />
      <button className="ai-primary" disabled={saving.isLoading || value.trim().length < 8}>Add key</button>
    </form>}
    {saving.isError && <p role="alert" className="ai-error">Couldn’t save the key.</p>}
  </li>;
}

function Backups({ data, value, onChange }: { data: AiSettings; value: Choice[]; onChange: (next: Choice[]) => void }) {
  const options = data.providers.filter(p => p.capabilities.includes('chat'));
  const move = (from: number, to: number) => { const next = [...value]; next.splice(to, 0, ...next.splice(from, 1)); onChange(next); };
  return <div className="ai-backups">
    <strong>Backup providers</strong>
    <small>Tried in order if the main provider fails. Each needs a saved key.</small>
    {value.map((choice, index) => <div key={index} className="ai-backup">
      <span className="ai-backup-n">{index + 1}</span>
      <select aria-label={`Backup ${index + 1} provider`} value={choice.provider} onChange={e => onChange(value.map((c, i) => i === index ? { provider: e.target.value, model: options.find(p => p.id === e.target.value)?.models.chat?.[0] ?? '' } : c))}>
        {options.map(p => <option key={p.id} value={p.id}>{p.label}{data.keys[p.id]?.configured ? '' : ' (no key)'}</option>)}</select>
      <input aria-label={`Backup ${index + 1} model`} value={choice.model} spellCheck={false} onChange={e => onChange(value.map((c, i) => i === index ? { ...c, model: e.target.value } : c))} />
      <button type="button" className="ai-ghost" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
      <button type="button" className="ai-ghost is-danger" aria-label="Remove backup" onClick={() => onChange(value.filter((_, i) => i !== index))}>×</button>
    </div>)}
    {value.length < data.limits.fallbacks && <button type="button" className="ai-ghost" onClick={() => {
      const pick = options.find(p => p.id !== value.at(-1)?.provider) ?? options[0];
      onChange([...value, { provider: pick.id, model: pick.models.chat?.[0] ?? '' }]);
    }}>＋ Add backup</button>}
  </div>;
}

function CapabilityCard({ capability, choice, data, onChange, children }: { capability: typeof capabilities[number]; choice: Choice; data: AiSettings; onChange: (c: Choice) => void; children?: ReactNode }) {
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
    {children}
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
      {data.byCapability.length ? <table className="ai-table"><thead><tr><th>Feature</th><th>Provider · model</th><th>Requests</th><th>Failures</th><th>Answered as backup</th><th>Input tokens</th><th>Output tokens</th></tr></thead>
        <tbody>{data.byCapability.map(r => <tr key={r.capability + r.provider + r.model}><td>{capabilities.find(c => c.key === r.capability)?.title}</td><td>{r.provider} · {r.model}</td>
          <td>{number.format(r.requests)}</td><td>{number.format(r.failures)}</td><td>{number.format(r.backups ?? 0)}</td><td>{number.format(r.input)}</td><td>{number.format(r.output)}</td></tr>)}</tbody></table>
        : <p className="ai-muted">No AI requests in this period.</p>}
    </>}
  </section>;
}

export function AiSettingsPage() {
  const settings = aiApi.useAiSettingsQuery();
  const [save, saving] = aiApi.useSaveAiSettingsMutation();
  const [draft, setDraft] = useState<Pick<AiSettings, Capability | 'dailyLimit' | 'fallbacks'> | null>(null);
  const [saved, setSaved] = useState(false);
  const data = settings.currentData?.data;
  if (settings.isError) return <section className="ai-admin"><p role="alert">Couldn’t load AI settings.</p></section>;
  if (!data) return <section className="ai-admin"><p role="status">Loading…</p></section>;
  const form = draft ?? { chat: data.chat, embeddings: data.embeddings, images: data.images, dailyLimit: data.dailyLimit, fallbacks: data.fallbacks };
  const change = (next: Partial<typeof form>) => { setSaved(false); setDraft({ ...form, ...next }); };
  async function submit(event: FormEvent) {
    event.preventDefault();
    try { await save(form).unwrap(); setDraft(null); setSaved(true); } catch { /* Shown below. */ }
  }
  return <section className="ai-admin" aria-labelledby="ai-title">
    <header className="ai-head"><h1 id="ai-title">AI providers</h1><p>Choose which provider powers each feature. Changes apply immediately.</p></header>
    <section className="ai-panel"><header><div><h2>API keys</h2><p>Save several keys per provider. The default is used first; if it fails, the others are tried in order. Each provider bills the account that owns its key.</p></div></header>
      <ul className="ai-keys">{data.providers.map(p => <KeyRow key={p.id} provider={p} data={data} />)}</ul></section>
    <form className="ai-panel" onSubmit={submit}>
      <header><div><h2>Features</h2><p>Save changes, then use Test to confirm each one works.</p></div></header>
      <div className="ai-cards">{capabilities.map(c => <CapabilityCard key={c.key} capability={c} choice={form[c.key]} data={data} onChange={choice => change({ [c.key]: choice })}>
        {c.key === 'chat' && <Backups data={data} value={form.fallbacks.chat} onChange={chat => change({ fallbacks: { chat } })} />}
      </CapabilityCard>)}</div>
      <label className="ai-limit">Daily AI requests per person<input type="number" min={1} max={10000} value={form.dailyLimit} onChange={e => change({ dailyLimit: Number(e.target.value) })} /></label>
      <div className="ai-actions"><button className="ai-primary" disabled={saving.isLoading || !draft}>{saving.isLoading ? 'Saving…' : 'Save changes'}</button>
        {draft && <button type="button" className="ai-ghost" onClick={() => setDraft(null)}>Discard</button>}
        {saved && <span className="ai-ok" role="status">Saved.</span>}
        {saving.isError && <span className="ai-error" role="alert">Couldn’t save. Check each provider supports its feature.</span>}</div>
    </form>
    <Usage />
  </section>;
}
