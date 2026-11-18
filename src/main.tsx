import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { onDevice } from './types';
import './styles.css';
const App = lazy(() => import('./App'));
const OpenPdf = lazy(() => import('./components/OpenPdf'));
const external = onDevice
  ? location.hash === '#/open-pdf'
  : new URLSearchParams(location.search).has('open-pdf');
createRoot(document.getElementById('root')!).render(
  <Suspense
    fallback={
      <div role="status" className="boot-work">
        {external ? 'Opening PDF…' : 'Opening workspace…'}
      </div>
    }
  >
    {external ? <OpenPdf /> : <App />}
  </Suspense>,
);
if (!onDevice && window.isSecureContext && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* The workspace also runs without install support. */
    });
  });
