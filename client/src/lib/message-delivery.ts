import { api, type Options } from './api/client';

/** A presence request alone is never proof that a device received a message. */
export async function fetchMessageUnread(options:Pick<Options<'messagesUnread'>,'signal'>={}) {
  const result=await api('messagesUnread',options);
  try {
    const pending=await api('messagesPendingDelivery',options);
    if(pending.messageIds.length||pending.groupMessageIds?.length)await api('messagesDelivered',{...options,body:pending});
  } catch { /* Keep the badge working; unacknowledged IDs are retried on the next poll. */ }
  return result;
}
