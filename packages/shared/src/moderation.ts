import { z } from "zod";

export const adminResourceKinds = ["memes", "templates", "comments", "tags", "stickers", "assets", "users"] as const;
export type AdminResourceKind = (typeof adminResourceKinds)[number];
export interface AdminAuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: "delete" | "soft_delete";
  targetKind: AdminResourceKind;
  targetId: string;
  label: string;
  snapshot: { ownerId: string | null; parentId: string | null; memeId: string | null; assetId: string | null };
  createdAt: string;
}
const pagination = {
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).default(""),
};
export const adminAuditQuerySchema = z.object({ ...pagination, kind: z.enum(adminResourceKinds).optional() });
