type AccountIconName = 'user' | 'dashboard' | 'shield' | 'logout' | 'edit' | 'mail' | 'calendar' | 'lock' | 'monitor' | 'arrow' | 'globe' | 'search' | 'filter' | 'tag' | 'activity' | 'link' | 'bell' | 'chat' | 'image'

export function AccountIcon({ name }: { name: AccountIconName }) {
  const paths: Record<AccountIconName, string> = {
    user: 'M20 21v-2a8 8 0 0 0-16 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    dashboard: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z',
    logout: 'M9 4H4v16h5m5-13 5 5-5 5m-6-5h11',
    edit: 'm16 3 5 5-12 12-6 1 1-6Zm-2 2 5 5',
    mail: 'M3 5h18v14H3zm0 1 9 7 9-7',
    calendar: 'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16',
    lock: 'M5 10h14v11H5zm3 0V7a4 4 0 0 1 8 0v3m-4 5v2',
    monitor: 'M3 4h18v13H3zm5 17h8m-4-4v4',
    arrow: 'm9 5 7 7-7 7',
    search: 'M17 17l5 5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z',
    filter: 'M3 4h18l-7 8v8l-4-2v-6Z',
    tag: 'M3 3h8l10 10-8 8L3 11ZM7 7h.01',
    activity: 'M12 3 2 21h20ZM12 9v5m0 3v.1',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12ZM8.5 12h.01M12 12h.01M15.5 12h.01',
    image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
    bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9c5 5 5 13 0 18-5-5-5-13 0-18Z',
  }
  return <svg className="account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
