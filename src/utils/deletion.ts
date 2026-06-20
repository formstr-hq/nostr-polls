import { Event, EventTemplate } from "nostr-tools";
import { signEvent } from "../nostr";
import { dataLayer, PublishResult } from "@formstr/local-relay";

/**
 * Publish a NIP-09 deletion (kind 5) for one or more event IDs.
 * Immediately applies the deletion to the local store so the UI reflects it
 * without waiting for a relay round-trip. The worker (local relay) owns relay
 * selection, so no relays are passed.
 *
 * @param ids   - Event IDs to delete
 * @param kinds - Kinds of the events being deleted (for the k tag)
 * @returns The signed deletion event and publish result
 */
export async function publishDeletion(
  ids: string[],
  kinds: number[]
): Promise<{ event: Event; result: PublishResult }> {
  const template: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ...ids.map((id) => ["e", id]),
      ...kinds.map((k) => ["k", String(k)]),
    ],
    content: "",
  };

  const signed = await signEvent(template);
  // Apply locally immediately so the store reflects the deletion right away
  dataLayer.addEvent(signed);
  const result = await dataLayer.publishEvent(signed);
  return { event: signed, result };
}
