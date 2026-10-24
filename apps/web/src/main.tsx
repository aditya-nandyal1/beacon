import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import App from './App';
import './styles.css';

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convex = url ? new ConvexReactClient(url) : null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <div className="setup">
        <h1>Beacon</h1>
        <p>
          Set <code>VITE_CONVEX_URL</code> in <code>apps/web/.env.local</code> (run <code>npx convex dev</code> once to create a deployment).
        </p>
      </div>
    )}
  </React.StrictMode>,
);
