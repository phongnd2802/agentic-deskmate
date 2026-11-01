import { getTranslations } from "next-intl/server";

import { Placeholder } from "@/components/placeholder";

export default async function AgentsPage() {
  const t = await getTranslations();
  return (
    <Placeholder
      title={t("pages.agents.title")}
      description={t("pages.agents.description")}
      note={t("placeholder.comingSoon")}
      back={t("placeholder.backToChat")}
    />
  );
}
