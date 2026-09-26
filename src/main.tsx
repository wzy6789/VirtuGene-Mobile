import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './styles/mobile-refinement.css';
import './styles/mobile-aurora.css';

const syncVisualActivity = () => document.documentElement.toggleAttribute('data-vg-background', document.hidden);
syncVisualActivity();
document.addEventListener('visibilitychange', syncVisualActivity);
if (import.meta.hot) import.meta.hot.dispose(() => document.removeEventListener('visibilitychange', syncVisualActivity));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
