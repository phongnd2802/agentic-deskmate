import { getTranslations } from "next-intl/server";

import { Placeholder } from "@/components/placeholder";

export default async function KnowledgeBasesPage() {
  const t = await getTranslations();
  return (
    <Placeholder
      title={t("pages.knowledgeBases.title")}
      description={t("pages.knowledgeBases.description")}
      note={t("placeholder.comingSoon")}
      back={t("placeholder.backToChat")}
    />
  );
}
