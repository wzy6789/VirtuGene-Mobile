import { createRoot } from 'react-dom/client';
import { db } from '../../src/db';
import { SecretarySetupModal } from '../../src/components/onboarding/SecretarySetupModal';
import { createSecretary } from '../../src/lib/secretary/character';
import { useAuthStore } from '../../src/store/auth-store';
import { useUIStore } from '../../src/store/ui-store';
import { installUiPreferences } from '../../src/lib/ui-preferences';
import { installUiFont } from '../../src/lib/ui-font';
import { installThemePreferences } from '../../src/lib/theme';
import { useThemeStore } from '../../src/store/theme-store';

installUiPreferences();
installUiFont();installThemePreferences();
const root = createRoot(document.getElementById('root')!);
let closed = 0, instance = 0, failRead = false, holdRead = false;
let release: (() => void) | undefined;
const read = db.secretaryBindings.get.bind(db.secretaryBindings);
(db.secretaryBindings as any).get = async (...args: any[]) => {
  if (failRead) { failRead = false; throw new Error('Controlled binding read failure'); }
  const value = await (read as any)(...args);
  if (holdRead) { holdRead = false; await new Promise<void>(done => { release = done; }); }
  return value;
};
const owner = 'setup-ui-owner';
async function reset() {
  root.render(null);
  await new Promise(done => requestAnimationFrame(done));
  release?.(); release = undefined; failRead = false; holdRead = false;
  await db.open(); await Promise.all(db.tables.map(table => table.clear()));
  useAuthStore.setState({ userId: owner, username: '引导验收', apiKey: null, isLoggedIn: true });
  useUIStore.setState({ activeView: 'chat', mobileTab: 'chat', assistantTab: 'today' });
  closed = 0;
}
function open() {
  root.render(<div className="mobile-layout" key={++instance}><SecretarySetupModal open welcome onClose={() => { closed++; root.render(<p>已关闭引导</p>); }} /></div>);
}
let writeFailures = 0;
const add = IDBObjectStore.prototype.add;
IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
  if (this.name === 'characters' && writeFailures) { writeFailures--; throw new DOMException('Controlled character write failure', 'UnknownError'); }
  return add.apply(this, args);
};
(window as any).setupUI = { reset, open, db, owner, closed: () => closed,
  theme:(theme:'dark'|'light')=>useThemeStore.getState().setTheme(theme),
  failRead: () => { failRead = true; }, holdRead: () => { holdRead = true; }, releaseRead: () => { release?.(); release = undefined; },
  failWrite: () => { writeFailures = 1; }, switchOwner: (userId: string) => useAuthStore.setState({ userId }),
  seedExisting: () => createSecretary(owner, '原来的助理'), view: () => useUIStore.getState().activeView,
};
