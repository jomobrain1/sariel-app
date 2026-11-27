import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../../app/auth';
import { AccountIcon } from '../../components/account-icon';
import { apiStatus } from '../../lib/api-status';
import { assistantApi, type ChatMessage, type Language } from './assistant.api';
import { RichText } from './rich-text';
import './assistant.css';

const NOTICE_KEY = 'sariel.assistant.notice';
const suggestions: Record<Language, string[]> = {
  en: ['What’s my safety status?', 'Who is in my circle?', 'When is my next check-in?', 'Tell my circle I’m travelling to Nairobi'],
  sw: ['Hali yangu ya usalama ni ipi?', 'Nani yuko kwenye kundi langu?', 'Ukaguzi wangu ujao ni lini?', 'Waambie kundi langu nasafiri Nairobi'],
};
const statusText = { pending: 'Waiting for you', done: 'Done', cancelled: 'Cancelled', failed: 'Failed' } as const;

function problem(error: unknown) {
  const status = apiStatus(error);
  if (status === 503) return 'The assistant isn’t set up yet. An administrator needs to add an AI provider key.';
  if (status === 429) return 'You’ve reached today’s limit or are sending too fast. Try again later.';
  if (status === 409) return 'Confirm or cancel the action above first.';
  return 'Something went wrong. Try again.';
}
function readNotice() { try { return localStorage.getItem(NOTICE_KEY) === 'seen'; } catch { return false; } }

function Message({ message, chat, busy, onError }: { message: ChatMessage; chat: string; busy: boolean; onError: (m: string) => void }) {
  const [decide, deciding] = assistantApi.useDecideMutation();
  async function choose(decision: 'confirm' | 'cancel') {
    onError('');
    try { await decide({ chat, action: message.action!.id, decision }).unwrap(); } catch (error) { onError(problem(error)); }
  }
  return <li className={'chat-msg is-' + message.role}>
    {!!message.steps.length && <div className="chat-steps">{message.steps.map(s => <span key={s}><AccountIcon name="search" />{s}</span>)}</div>}
    {message.text && <div className="chat-bubble">{message.role === 'assistant' ? <RichText text={message.text} /> : message.text}</div>}
    {message.action && <div className={'chat-action is-' + message.action.status}>
      <strong>{message.action.summary}</strong>
      {message.action.status === 'pending' ? <div className="chat-action-buttons">
        <button className="chat-primary" disabled={busy || deciding.isLoading} onClick={() => void choose('confirm')}>{deciding.isLoading ? 'Working…' : 'Confirm'}</button>
        <button className="chat-ghost" disabled={busy || deciding.isLoading} onClick={() => void choose('cancel')}>Cancel</button>
      </div> : <small>{statusText[message.action.status]}</small>}
    </div>}
  </li>;
}

function Conversation({ id }: { id: string }) {
  const chat = assistantApi.useChatQuery(id);
  const [send, sending] = assistantApi.useSendMutation();
  const [, deciding] = assistantApi.useDecideMutation({ fixedCacheKey: 'decide-' + id });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const data = chat.currentData?.data;
  const pending = data?.messages.some(m => m.action?.status === 'pending');
  const busy = sending.isLoading || deciding.isLoading;
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data?.messages.length, sending.isLoading]);
  async function submit(value = text) {
    const message = value.trim();
    if (!message || busy) return;
    setError(''); setText('');
    try { await send({ id, text: message }).unwrap(); } catch (failure) { setError(problem(failure)); setText(message); }
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
  }
  if (chat.isError) return <div className="chat-main"><p role="alert" className="chat-empty">This conversation is unavailable.</p></div>;
  if (!data) return <div className="chat-main"><p role="status" className="chat-empty">Loading…</p></div>;
  return <div className="chat-main">
    <ol className="chat-log" aria-live="polite">
      {!data.messages.length && <li className="chat-welcome">
        <span className="chat-avatar"><AccountIcon name="shield" /></span>
        <h2>{data.language === 'sw' ? 'Nikusaidie vipi leo?' : 'How can I help today?'}</h2>
        <p>{data.language === 'sw' ? 'Naweza kuangalia hali yako, kundi lako na ukaguzi, na kukusaidia kuripoti au kutuma taarifa.' : 'I can check your status, circle and check-ins, and help you report, check in or post an update. You confirm every action.'}</p>
        <div className="chat-suggestions">{suggestions[data.language].map(s => <button key={s} disabled={busy} onClick={() => void submit(s)}>{s}</button>)}</div>
      </li>}
      {data.messages.map(m => <Message key={m.id} message={m} chat={id} busy={busy} onError={setError} />)}
      {busy && <li className="chat-msg is-assistant"><div className="chat-bubble chat-typing" aria-label="Assistant is thinking"><span /><span /><span /></div></li>}
    </ol>
    <div ref={end} />
    <form className="chat-composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(); }}>
      {error && <p role="alert" className="chat-error">{error}</p>}
      <div><textarea rows={1} maxLength={2000} value={text} disabled={pending} onChange={e => setText(e.target.value)} onKeyDown={onKey}
        placeholder={pending ? 'Confirm or cancel the action above' : data.language === 'sw' ? 'Andika ujumbe…' : 'Message the assistant…'} aria-label="Message" />
        <button className="chat-send" disabled={busy || pending || !text.trim()} aria-label="Send"><AccountIcon name="arrow" /></button></div>
      <small>The assistant can make mistakes. In an emergency, use <Link to="/dashboard">Report an incident</Link>.</small>
    </form>
  </div>;
}

export function AssistantPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const chats = assistantApi.useChatsQuery(undefined, { skip: !user || !!user.tenant });
  const [create, creating] = assistantApi.useNewChatMutation();
  const [remove] = assistantApi.useDeleteChatMutation();
  const [language, setLanguage] = useState<Language>('en');
  const [noticeSeen, setNoticeSeen] = useState(readNotice);
  const [error, setError] = useState('');
  if (user?.tenant) return <Navigate to="/dashboard" replace />;
  const list = chats.currentData?.data ?? [];
  const active = params.get('chat') ?? list[0]?.id ?? null;
  async function start() {
    setError('');
    try { const chat = (await create(language).unwrap()).data; setParams({ chat: chat.id }); } catch (failure) { setError(problem(failure)); }
  }
  function acceptNotice() { try { localStorage.setItem(NOTICE_KEY, 'seen'); } catch { /* Shown again next time. */ } setNoticeSeen(true); }

  return <section className="chat-page" aria-labelledby="assistant-title">
    <aside className="chat-side">
      <header><h1 id="assistant-title">Assistant</h1></header>
      <div className="chat-new">
        <div className="chat-lang" role="group" aria-label="Language">{(['en', 'sw'] as const).map(l =>
          <button key={l} aria-pressed={language === l} onClick={() => setLanguage(l)}>{l === 'en' ? 'English' : 'Kiswahili'}</button>)}</div>
        <button className="chat-primary" disabled={creating.isLoading || !noticeSeen} onClick={() => void start()}><span aria-hidden="true">＋</span> New chat</button>
      </div>
      {error && <p role="alert" className="chat-error">{error}</p>}
      <ul className="chat-list">{list.map(c => <li key={c.id} className={c.id === active ? 'is-active' : undefined}>
        <button onClick={() => setParams({ chat: c.id })}><strong>{c.title}</strong><small>{c.language === 'sw' ? 'Kiswahili' : 'English'} · {new Date(c.updatedAt).toLocaleDateString()}</small></button>
        <button className="chat-delete" aria-label={`Delete ${c.title}`} onClick={() => { void remove(c.id); if (c.id === active) setParams({}); }}>×</button>
      </li>)}</ul>
    </aside>
    {!noticeSeen ? <div className="chat-main"><div className="chat-notice">
      <span className="chat-avatar"><AccountIcon name="shield" /></span>
      <h2>Before you start</h2>
      <ul>
        <li>Your messages are processed by an outside AI service chosen by Sariel to answer you.</li>
        <li>Don’t share passwords, codes or exact addresses in the chat.</li>
        <li>The assistant can look up your status, circle and check-ins. It never acts without your confirmation.</li>
        <li>It can make mistakes and doesn’t give legal advice. In an emergency, use Report an incident.</li>
      </ul>
      <button className="chat-primary" onClick={acceptNotice}>I understand</button>
    </div></div>
      : active ? <Conversation key={active} id={active} />
      : <div className="chat-main"><div className="chat-empty"><span className="chat-avatar"><AccountIcon name="shield" /></span>
        <h2>Ask about your safety, circle or check-ins</h2><p>Choose a language and start a new chat.</p>
        <button className="chat-primary" disabled={creating.isLoading} onClick={() => void start()}>Start a chat</button></div></div>}
  </section>;
}
