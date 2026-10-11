export type ProfileFields = { displayName: string; username: string; bio: string; location: string; website: string };
export const PROFILE_LIMITS: Record<keyof ProfileFields, number> = { displayName: 50, username: 30, bio: 300, location: 100, website: 200 };
export function profileFields(user: { displayName: string; username: string; bio?: string | null; location?: string | null; website?: string | null }): ProfileFields {
  return { displayName: user.displayName, username: user.username, bio: user.bio ?? "", location: user.location ?? "", website: user.website ?? "" };
}
export function validateProfile(fields: ProfileFields): Partial<Record<keyof ProfileFields, string>> {
  const errors: Partial<Record<keyof ProfileFields, string>> = {};
  if (!fields.displayName.trim()) errors.displayName = "Display name is required.";
  if (!/^[A-Za-z0-9_]{3,30}$/.test(fields.username)) errors.username = "Use 3–30 letters, numbers or underscores.";
  if (fields.website.trim()) {
    try { const url = new URL(fields.website.trim()); if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) throw new Error(); }
    catch { errors.website = "Use a full website link starting with https:// or http://"; }
  }
  for (const key of Object.keys(PROFILE_LIMITS) as (keyof ProfileFields)[]) if (fields[key].length > PROFILE_LIMITS[key]) errors[key] = `Maximum ${PROFILE_LIMITS[key]} characters.`;
  return errors;
}
export function profilePatch(fields: ProfileFields, original: ProfileFields, isPrivate: boolean, originalPrivate: boolean) {
  const body: { displayName?: string; username?: string; bio?: string | null; location?: string | null; website?: string | null; isPrivate?: boolean } = {};
  for (const key of Object.keys(PROFILE_LIMITS) as (keyof ProfileFields)[]) {
    if (fields[key] !== original[key]) { const value = fields[key].trim(); if (key === "displayName" || key === "username") body[key] = value; else body[key] = value || null; }
  }
  if (isPrivate !== originalPrivate) body.isPrivate = isPrivate;
  return body;
}
