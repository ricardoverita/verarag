import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'VeraRAG',
  description:
    'Open-source enterprise knowledge and retrieval platform built for secure, explainable and observable RAG systems.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
