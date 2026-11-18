import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { onDevice } from './types';
import './styles.css';
const App = lazy(() => import('./App'));
const OpenFile = lazy(() => import('./components/OpenFile'));
const external = onDevice
  ? ['#/open-file', '#/open-pdf'].includes(location.hash)
  : ['open-file', 'open-pdf'].some((k) => new URLSearchParams(location.search).has(k));
createRoot(document.getElementById('root')!).render(
  <Suspense
    fallback={
      <div role="status" className="boot-work">
        {external ? 'Opening document…' : 'Opening workspace…'}
      </div>
    }
  >
    {external ? <OpenFile /> : <App />}
  </Suspense>,
);
if (!onDevice && window.isSecureContext && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* The workspace also runs without install support. */
    });
  });
