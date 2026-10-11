/** Actual attachments define content, including originals embedded by reposts/quotes.
 * Status is intentionally ignored: a processing/failed video never becomes a home photo.
 */
export const hasVideoSql = (p: string) => `EXISTS (
  SELECT 1 FROM post_media cm JOIN media cv ON cv.id=cm.media_id
  WHERE cv.type='VIDEO' AND (cm.post_id=${p}.id OR
    (${p}.kind IN ('REPOST','QUOTE') AND cm.post_id=${p}.referenced_post_id))
)`;
export type ContentFilter = 'home' | 'reels' | 'all';
export const contentSql = (p: string, filter: ContentFilter) =>
  filter === 'all' ? 'TRUE' : `${filter === 'home' ? 'NOT ' : ''}(${hasVideoSql(p)})`;
