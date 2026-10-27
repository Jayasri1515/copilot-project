import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp } from './composition/createApp';

const rootElement = document.querySelector('#root');

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('Application root element was not found.');
}

createRoot(rootElement).render(<StrictMode>{createApp()}</StrictMode>);
