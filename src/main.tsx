import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './styles/theme-tokens.css';
import './styles/todo-ui.css';
import './styles/chat-bubbles.css';
import './styles/soul-handoff.css';
import './styles/soul-orb.css';
import './styles/action-cabin.css';
import './styles/mobile-refinement.css';
import './styles/mobile-aurora.css';
import './styles/physical-interactions.css';
import './styles/mobile-soul.css';
import './styles/secretary-ui.css';
import './styles/settings-ui.css';
import './styles/ui-fonts.css';
import './styles/typography.css';
import './styles/ui-performance.css';
import './styles/notifications.css';
import './styles/splash.css';
import './styles/input-surfaces.css';
import './styles/feedback.css';
import './styles/ui-v2.css';
import './styles/mobile-pages.css';
import { installUiPreferences } from './lib/ui-preferences';
import { installThemePreferences } from './lib/theme';
import { installUiFont } from './lib/ui-font';

import { warmHaptics } from './lib/haptics';
warmHaptics();

const removeUiPreferences = installUiPreferences();
const removeThemePreferences = installThemePreferences();
const removeUiFont = installUiFont();
if (import.meta.hot) import.meta.hot.dispose(removeUiPreferences);
if (import.meta.hot) import.meta.hot.dispose(removeThemePreferences);
if (import.meta.hot) import.meta.hot.dispose(removeUiFont);

const syncVisualActivity = () => document.documentElement.toggleAttribute('data-vg-background', document.hidden);
syncVisualActivity();
document.addEventListener('visibilitychange', syncVisualActivity);
if (import.meta.hot) import.meta.hot.dispose(() => document.removeEventListener('visibilitychange', syncVisualActivity));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
