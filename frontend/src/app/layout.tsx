import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";

import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
