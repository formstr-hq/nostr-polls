import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Event } from 'nostr-tools';
import { useNostrNotifications } from '../contexts/nostr-notification-context';
import { Conversation } from '../contexts/dm-context';
import { useDMContext } from './useDMContext';
import { useUserContext } from './useUserContext';
import { useRelays } from './useRelays';
import { initLocalNotifications, fireNotification } from '../services/localNotificationService';

// TODO: change to 60 * 60 * 1000 (1 hour) for production
const JS_CHECK_MS = 5 * 60 * 1000; // 5 minutes — JS foreground interval

const NOTIF_ID_EVENTS = 1001;
const NOTIF_ID_DMS    = 1002;

function buildEventBody(notifications: Map<string, Event>, lastSeen: number | null): string {
  const unread = Array.from(notifications.values())
    .filter(ev => lastSeen === null || ev.created_at > lastSeen);

  let pollResponses = 0, mentions = 0, reactions = 0, zaps = 0;
  for (const ev of unread) {
    if (ev.kind === 1018) pollResponses++;
    else if (ev.kind === 1) mentions++;
    else if (ev.kind === 7) reactions++;
    else if (ev.kind === 9735) zaps++;
  }

  const parts: string[] = [];
  if (pollResponses > 0) parts.push(`${pollResponses} poll response${pollResponses > 1 ? 's' : ''}`);
  if (mentions > 0)      parts.push(`${mentions} mention${mentions > 1 ? 's' : ''}`);
  if (reactions > 0)     parts.push(`${reactions} reaction${reactions > 1 ? 's' : ''}`);
  if (zaps > 0)          parts.push(`${zaps} zap${zaps > 1 ? 's' : ''}`);

  return parts.length > 0 ? parts.join(', ') : `${unread.length} new notification${unread.length > 1 ? 's' : ''}`;
}

function buildDMBody(conversations: Map<string, Conversation>, userPubkey: string | undefined): string {
  const unreadConvs = Array.from(conversations.values()).filter(c => c.unreadCount > 0);
  if (unreadConvs.length === 0) return 'New message';

  const total = unreadConvs.reduce((s, c) => s + c.unreadCount, 0);

  if (unreadConvs.length === 1) {
    const conv = unreadConvs[0];
    const otherPubkey = conv.participants.find(p => p !== userPubkey) ?? '';
    const shortKey = otherPubkey ? `${otherPubkey.slice(0, 8)}…` : 'someone';
    return `${total} new message${total > 1 ? 's' : ''} from ${shortKey}`;
  }

  return `${total} new messages from ${unreadConvs.length} people`;
}

export function useAndroidNotifications() {
  const { unreadCount, notifications, lastSeen } = useNostrNotifications();
  const { unreadTotal: dmUnread, conversations } = useDMContext();
  const { user } = useUserContext();
  const { relays } = useRelays();
  const permitted = useRef(false);
  const prevEvents = useRef(0);
  const prevDMs    = useRef(0);

  // Request permission once
  useEffect(() => {
    console.log('[AndroidNotif] hook mounted, requesting permission');
    initLocalNotifications().then(ok => {
      console.log('[AndroidNotif] permission granted:', ok);
      permitted.current = ok;
    });
  }, []);

  // Bridge: save pubkey for WorkManager Worker
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!user?.pubkey) return;
    console.log('[AndroidNotif] saving worker_pubkey');
    Preferences.set({ key: 'worker_pubkey', value: user.pubkey });
  }, [user?.pubkey]);

  // Bridge: save first relay for WorkManager Worker
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!relays?.length) return;
    console.log('[AndroidNotif] saving worker_relay:', relays[0]);
    Preferences.set({ key: 'worker_relay', value: relays[0] });
  }, [relays]);

  // Fire when new Nostr events arrive while backgrounded
  useEffect(() => {
    console.log('[AndroidNotif] unreadCount changed:', unreadCount,
      '| prev:', prevEvents.current, '| permitted:', permitted.current, '| hidden:', document.hidden);
    if (!permitted.current) { prevEvents.current = unreadCount; return; }
    if (unreadCount > prevEvents.current && document.hidden) {
      fireNotification(NOTIF_ID_EVENTS, 'Pollerama', buildEventBody(notifications, lastSeen));
    }
    prevEvents.current = unreadCount;
  }, [unreadCount, notifications, lastSeen]);

  // Fire when new DMs arrive while backgrounded
  useEffect(() => {
    console.log('[AndroidNotif] dmUnread changed:', dmUnread,
      '| prev:', prevDMs.current, '| permitted:', permitted.current, '| hidden:', document.hidden);
    if (!permitted.current) { prevDMs.current = dmUnread; return; }
    if (dmUnread > prevDMs.current && document.hidden) {
      fireNotification(NOTIF_ID_DMS, 'Pollerama', buildDMBody(conversations, user?.pubkey));
    }
    prevDMs.current = dmUnread;
  }, [dmUnread, conversations, user?.pubkey]);

  // Periodic JS check (foreground/backgrounded-but-alive)
  useEffect(() => {
    const id = setInterval(() => {
      if (!permitted.current || !document.hidden) return;
      if (unreadCount > 0)
        fireNotification(NOTIF_ID_EVENTS, 'Pollerama', buildEventBody(notifications, lastSeen));
      if (dmUnread > 0)
        fireNotification(NOTIF_ID_DMS, 'Pollerama', buildDMBody(conversations, user?.pubkey));
    }, JS_CHECK_MS);
    return () => clearInterval(id);
  }, [unreadCount, dmUnread, notifications, lastSeen, conversations, user?.pubkey]);
}
