import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import './index.css';
import './shell.css';
import './workspace.css';
import './responsive.css';
import './pages/AccountCenter/preferences.css';
import './ui-system.css';
import { ThemeCardProvider } from './theme/ThemeCardProvider';

const router = createBrowserRouter([{path:'*',element:<App/>}]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeCardProvider>
      <RouterProvider router={router} />
    </ThemeCardProvider>
  </React.StrictMode>,
);
