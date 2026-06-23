import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata = {
  title: 'PH-ERP Accounting System',
  description: 'Philippine-compliant ERP Accounting System — BIR, SSS, PhilHealth, Pag-IBIG',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      </body>
    </html>
  );
}
