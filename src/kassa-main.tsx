import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './lib/i18n';
import KassaApp from './KassaApp.tsx';
import { AppWrapper } from './components/common/PageMeta.tsx';
import { installRemotePosApiIfConfigured } from './lib/remotePosApi';

installRemotePosApiIfConfigured();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppWrapper>
      <KassaApp />
    </AppWrapper>
  </StrictMode>,
);
