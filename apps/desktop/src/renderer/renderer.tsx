import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConfirmationProvider } from './components/ConfirmationProvider';
import { AccountProvider } from './features/accounts/AccountProvider';
import './styles/index.css';

if (navigator.platform.startsWith('Win'))
  document.documentElement.dataset.platform = 'windows';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountProvider>
      <ConfirmationProvider>
        <App />
      </ConfirmationProvider>
    </AccountProvider>
  </StrictMode>,
);
