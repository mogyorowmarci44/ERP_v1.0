/** v6.11.0 – szerepkörök egy helyen. */
export type Role = "owner" | "accountant" | "viewer" | "uploader";
export const ROLES: Role[] = ["owner", "accountant", "viewer", "uploader"];
export const ROLE_LABEL: Record<Role, string> = { owner: "tulajdonos", accountant: "könyvelő", viewer: "CEO - Ügyvezető", uploader: "bizonylatfeltöltő" };
export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as string[]).includes(r);
