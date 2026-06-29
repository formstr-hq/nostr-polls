import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Event } from "nostr-tools";
import { dataLayer, type ObserveHandle } from "@formstr/local-relay";
import {
  AndroidAsset,
  APP_ID,
  ASSET_KIND,
  RELEASE_KIND,
  ReleaseInfo,
  compareVersions,
  getPublisherHex,
  parseAndroidAsset,
  parseRelease,
  selectAndroidAsset,
} from "../nostr/nip82";

const DISMISS_KEY = "pollerama:update-dismissed-version";

export type AppUpdate = {
  currentVersion: string;
  currentVersionCode?: number;
  latestVersion: string;
  releaseNotes: string;
  asset: AndroidAsset;
  /** True when min_allowed_version_code on the asset is above the installed build. */
  required: boolean;
};

export type UseAppUpdateResult = {
  update: AppUpdate | null;
  dismiss: () => void;
};

/**
 * Subscribes to NIP-82 release events for Pollerama and surfaces an update
 * when a newer version is available. Android-only — returns null on web/iOS.
 */
export function useAppUpdate(): UseAppUpdateResult {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const latestReleaseRef = useRef<ReleaseInfo | null>(null);
  const assetsRef = useRef<Map<string, Event>>(new Map());
  const currentRef = useRef<{ version: string; build?: number } | null>(null);
  const dismissedRef = useRef<string | null>(
    typeof window !== "undefined" ? localStorage.getItem(DISMISS_KEY) : null
  );

  const recompute = useCallback(() => {
    const release = latestReleaseRef.current;
    const current = currentRef.current;
    if (!release || !current) return;

    if (compareVersions(release.version, current.version) <= 0) {
      setUpdate(null);
      return;
    }

    const candidates: AndroidAsset[] = [];
    for (const id of release.assetIds) {
      const ev = assetsRef.current.get(id);
      if (!ev) continue;
      const asset = parseAndroidAsset(ev);
      if (asset) candidates.push(asset);
    }
    if (!candidates.length) return; // wait for asset events

    const asset = selectAndroidAsset(candidates);
    if (!asset) return;

    const required =
      asset.minAllowedVersionCode !== undefined &&
      current.build !== undefined &&
      current.build < asset.minAllowedVersionCode;

    if (!required && dismissedRef.current === release.version) {
      setUpdate(null);
      return;
    }

    setUpdate({
      currentVersion: current.version,
      currentVersionCode: current.build,
      latestVersion: release.version,
      releaseNotes: release.releaseNotes,
      asset,
      required,
    });
  }, []);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    let cancelled = false;
    let releaseHandle: ObserveHandle | null = null;
    let assetHandle: ObserveHandle | null = null;

    (async () => {
      try {
        const info = await CapApp.getInfo();
        if (cancelled) return;
        currentRef.current = {
          version: info.version,
          build: info.build ? Number(info.build) : undefined,
        };
      } catch (e) {
        console.warn("[useAppUpdate] App.getInfo failed:", e);
        return;
      }

      const publisher = getPublisherHex();

      releaseHandle = dataLayer.observe(
        [
          {
            kinds: [RELEASE_KIND],
            authors: [publisher],
            "#i": [APP_ID],
          },
        ],
        {
          onEvent: (event: Event) => {
            const release = parseRelease(event);
            if (!release) return;
            // Only consider main channel for now.
            if (release.channel !== "main") return;
            const prev = latestReleaseRef.current;
            if (!prev || compareVersions(release.version, prev.version) > 0) {
              latestReleaseRef.current = release;
              // Subscribe to the asset events for this release.
              assetHandle?.unobserve();
              assetHandle = dataLayer.observe(
                [
                  {
                    kinds: [ASSET_KIND],
                    authors: [publisher],
                    ids: release.assetIds,
                  },
                ],
                {
                  onEvent: (assetEvent: Event) => {
                    assetsRef.current.set(assetEvent.id, assetEvent);
                    recompute();
                  },
                }
              );
              recompute();
            }
          },
        }
      );
    })();

    return () => {
      cancelled = true;
      releaseHandle?.unobserve();
      assetHandle?.unobserve();
    };
  }, [recompute]);

  const dismiss = useCallback(() => {
    const release = latestReleaseRef.current;
    if (release) {
      localStorage.setItem(DISMISS_KEY, release.version);
      dismissedRef.current = release.version;
    }
    setUpdate(null);
  }, []);

  return { update, dismiss };
}
