import { getTranslations } from "next-intl/server";

import { Placeholder } from "@/components/placeholder";

export default async function DashboardPage() {
  const t = await getTranslations();
  return (
    <Placeholder
      title={t("pages.dashboard.title")}
      description={t("pages.dashboard.description")}
      note={t("placeholder.comingSoon")}
      back={t("placeholder.backToChat")}
    />
  );
}
