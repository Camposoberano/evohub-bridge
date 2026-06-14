import "./globals.css";

export const metadata = {
  title: "Soberano — Painel",
  description: "Conexões e atendimento — Facebook, Instagram e WhatsApp",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
