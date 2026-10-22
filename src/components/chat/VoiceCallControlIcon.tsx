/** Call controls use fuller silhouettes that remain readable on a small disc. */
export function VoiceCallControlIcon({ kind, muted = false }: {
  kind: 'mic' | 'speaker' | 'text' | 'phone'; muted?: boolean;
}) {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'mic' && <><path d="M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5ZM5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/>{muted && <path d="m3 3 18 18"/>}</>}
    {kind === 'speaker' && <><path d="M3 9h4l5-4v14l-5-4H3Z" fill="currentColor"/><path d="M16 8q4 4 0 8M19 5q7 7 0 14"/></>}
    {kind === 'text' && <path d="M4 5h16M4 10h16M4 15h11M4 5v15M8 19h7"/>}
    {kind === 'phone' && <path d="M2.4 10.4c5.3-5.2 13.9-5.2 19.2 0 .7.7.6 1.8-.1 2.5l-2 2c-.6.6-1.7.6-2.3-.1l-2-2.1v-2.1a11.8 11.8 0 0 0-6.4 0v2.1l-2 2.1c-.6.7-1.7.7-2.3.1l-2-2c-.7-.7-.8-1.8-.1-2.5Z" fill="currentColor" stroke="none"/>}
  </svg>;
}
