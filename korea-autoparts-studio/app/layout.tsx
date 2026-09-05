import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Korea Autoparts Image Studio',
  description: '자동차 부품 대표이미지 제작 작업 화면',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
