import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './styles/mobile-refinement.css';
import './styles/mobile-aurora.css';
import './styles/physical-interactions.css';
import './styles/mobile-soul.css';
import './styles/secretary-ui.css';
import './styles/settings-ui.css';
import './styles/ui-fonts.css';
import './styles/typography.css';
import './styles/ui-performance.css';
import { installUiPreferences } from './lib/ui-preferences';

const removeUiPreferences = installUiPreferences();
if (import.meta.hot) import.meta.hot.dispose(removeUiPreferences);

const syncVisualActivity = () => document.documentElement.toggleAttribute('data-vg-background', document.hidden);
syncVisualActivity();
document.addEventListener('visibilitychange', syncVisualActivity);
if (import.meta.hot) import.meta.hot.dispose(() => document.removeEventListener('visibilitychange', syncVisualActivity));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
