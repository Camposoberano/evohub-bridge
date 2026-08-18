import "./globals.css";

export const metadata = {
  // Título curto de propósito: a aba corta pelo fim, e "Soberano" é o que identifica o
  // painel entre dez abas abertas — "— Painel" só ocupava espaço.
  title: "Soberano",
  description: "Conexões, atendimento e campanhas — WhatsApp, Facebook e Instagram",
  // O App Router acha `app/icon.svg` sozinho; declarar aqui estende o mesmo ícone para o
  // atalho de tela inicial no celular.
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport = {
  // Pinta a barra do navegador no celular com o roxo da marca.
  themeColor: "#a855f7",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Manrope:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
