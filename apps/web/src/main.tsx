import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import { AuthGate } from './auth/AuthGate';
import { authEnabled, msalInstance } from './auth/msalConfig';
import './styles.css';

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById('root')!);

  // Auth disabled (no app registration yet) → render the app directly.
  if (!authEnabled || !msalInstance) {
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>,
    );
    return;
  }

  // MSAL v5 must be initialized before use; then complete any redirect sign-in.
  await msalInstance.initialize();
  await msalInstance.handleRedirectPromise();

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <MsalProvider instance={msalInstance}>
          <AuthGate>
            <App />
          </AuthGate>
        </MsalProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
}

void bootstrap();

