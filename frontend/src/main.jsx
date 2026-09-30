import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AuthProvider from './auth/AuthProvider';
import { initializeMsal } from './auth/authService';
import App from './App';
import './assets/styles.css';

async function start() {
  // Process the Microsoft sign-in response (if any) before React renders
  let redirectResult = null;
  let redirectError = null;
  try {
    redirectResult = await initializeMsal();
  } catch (err) {
    redirectError = err;
  }

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider redirectResult={redirectResult} redirectError={redirectError}>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>
  );
}

start();
