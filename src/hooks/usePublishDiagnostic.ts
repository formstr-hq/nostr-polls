import { useState, useRef, useCallback } from "react";
import { Event } from "nostr-tools";
import { dataLayer, PublishResult } from "@formstr/local-relay";

/**
 * Shared state and retry logic for publish diagnostic modals.
 *
 * Usage:
 *   const { result, open, setOpen, title, openModal, retry } = usePublishDiagnostic();
 *
 *   // After publishing:
 *   openModal(signedEvent, publishResult, "Note publish results");
 *
 *   // In JSX:
 *   {result && (
 *     <PublishDiagnosticModal
 *       open={open}
 *       onClose={() => setOpen(false)}
 *       title={title}
 *       entries={result.relayResults}
 *       onRetry={retry}
 *     />
 *   )}
 */
export function usePublishDiagnostic() {
  const [result, setResult] = useState<PublishResult | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Publish results");
  const eventRef = useRef<Event | null>(null);

  const openModal = useCallback(
    (event: Event, publishResult: PublishResult, modalTitle?: string) => {
      eventRef.current = event;
      setResult(publishResult);
      if (modalTitle) setTitle(modalTitle);
      setOpen(true);
    },
    []
  );

  const retry = useCallback(
    async (relay?: string) => {
      const event = eventRef.current;
      if (!event || !result) return result?.relayResults ?? [];
      // The worker owns relay selection now, so a retry simply re-publishes the
      // whole event; the worker reaches whichever relays previously failed.
      const retryResult = await dataLayer.publishEvent(event);
      const retryMap = new Map(retryResult.relayResults.map((r) => [r.relay, r]));
      const merged = result.relayResults.map((r) => retryMap.get(r.relay) ?? r);
      const updated: PublishResult = {
        ...result,
        relayResults: merged,
        ok: merged.some((r) => r.status === "accepted"),
      };
      setResult(updated);
      return merged;
    },
    [result]
  );

  return { result, open, setOpen, title, openModal, retry };
}
