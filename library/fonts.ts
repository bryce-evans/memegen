/** Browser-safe source identities; six checkout fonts serve four catalog caption roles. */
export const CATALOG_FONT_ROLES = ["impact", "sans", "thin", "comic"] as const;
export type CatalogFontRole = typeof CATALOG_FONT_ROLES[number];

interface LibraryFont {
  file: string;
  name: string;
  aliases: readonly string[];
  role?: CatalogFontRole;
}

export const LIBRARY_FONTS: readonly LibraryFont[] = [
  { file: "Impact.ttf", name: "Impact", aliases: ["impact"], role: "impact" },
  { file: "TitilliumWeb-Black.ttf", name: "Titillium Web Black", aliases: ["thick", "titilliumweb"] },
  { file: "TitilliumWeb-SemiBold.ttf", name: "Titillium Web SemiBold", aliases: ["thin", "titilliumweb-thin"], role: "thin" },
  { file: "NotoSans-Bold.ttf", name: "Noto Sans Bold", aliases: ["notosans", "tiny", "segoe", "jp", "hgminchob"], role: "sans" },
  { file: "Kalam-Regular.ttf", name: "Kalam", aliases: ["comic", "kalam"], role: "comic" },
  { file: "NotoSansHebrew-Bold.ttf", name: "Noto Sans Hebrew Bold", aliases: ["he", "notosanshebrew"] },
];

export function catalogFontUrl(role: CatalogFontRole): string {
  return `/fonts/${role}.ttf`;
}
