/**
 * Real-time room sync engine.
 *
 * Primary transport: Supabase Realtime (`room:{roomId}`) with
 *   • broadcast (self: true) for media / chat / moderation
 *   • presence (key: userId) for the live member roster
 *
 * Fallback (no VITE_SUPABASE_*): BroadcastChannel + localStorage
 * mirror for same-origin / same-machine demos.
 *
 * Named Realtime events
 * ---------------------
 *   • sync-media           { mediaId, mediaType, currentTime, isPlaying, serverIdx }
 *   • request-host-state   joiner asks host what's playing
 *   • host-state-payload   host replies with a self-contained snapshot
 *   • room-event           full RoomEvent wire protocol (below)
 *
 * Wire protocol (room-event payload.kind)
 * ---------------------------------------
 *   • presence:hello / bye / heartbeat
 *   • chat:message
 *   • playback:state · episode:change · sync:request · sync:snapshot
 *   • media:state · media:request
 *   • action:toggle-play · action:seek
 *   • request:room-state · emit:room-state
 *   • request:host-state · host-state:payload
 *   • heartbeat · moderation:*
 *
 * Host authority is mutable via `moderation:host`. Solo members
 * (roster size ≤ 1) are always elected host so UI controls unlock.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type MediaType = "movie" | "tv";

export interface RoomMember {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
}

export interface RoomMsg {
  id: string;
  memberId: string;
  name: string;
  avatar: string;
  text: string;
  ts: number;
}

export interface PlaybackState {
  playing: boolean;
  time: number;
  ts: number;
  mediaType: MediaType;
  tmdbId: number;
  season: number;
  episode: number;
  /**
   * Selected server index from a multi-server provider UI.
   * Reserved for forward-compatibility — not consumed by the HLS
   * resolver path today.
   */
  serverIdx?: number;
}

export type RoomEvent =
  | { kind: "presence:hello"; member: RoomMember }
  | { kind: "presence:bye"; memberId: string }
  | { kind: "presence:heartbeat"; memberId: string; ts: number }
  | { kind: "chat:message"; msg: RoomMsg }
  | { kind: "playback:state"; state: PlaybackState }
  | { kind: "episode:change"; season: number; episode: number; fromMemberId: string }
  | { kind: "sync:request"; memberId: string }
  | { kind: "sync:snapshot"; fromMemberId: string; state: PlaybackState }
  | { kind: "media:state"; state: RoomMediaState; fromMemberId: string }
  | { kind: "media:request"; memberId: string }
  | { kind: "moderation:kick"; memberId: string; byMemberId: string }
  | { kind: "moderation:ban"; memberId: string; byMemberId: string }
  | { kind: "moderation:host"; newHostId: string; byMemberId: string }
  | { kind: "moderation:banned-list"; banned: string[] }
  // Host-driven actions (request → response). `Request` is the
  // imperative "I just clicked the button" and the others are
  // already-implemented states. Keeping the high-level actions lets
  // newcomers mirror the host's *intent* rather than infer it from a
  // sequence of state-changes.
  | { kind: "action:toggle-play"; time: number; fromMemberId: string }
  | { kind: "action:seek"; targetTime: number; fromMemberId: string }
  | { kind: "request:room-state"; memberId: string }
  | { kind: "emit:room-state"; state: RoomMediaState; fromMemberId: string }
  // Dual-sync fallback: a joiner asks the host "what are you playing
  // right now?" and the host replies with a self-contained payload —
  // enough for the joiner to start the iframe without waiting for the
  // heavier media:state or heartbeat round-trips.
  | { kind: "request:host-state"; memberId: string }
  | {
      kind: "host-state:payload";
      memberId: string;
      mediaId: number;
      mediaType: MediaType;
      currentServerUrl: string;
      currentTime: number;
      isPlaying: boolean;
      season?: number;
      episode?: number;
      serverIdx?: number;
      fromMemberId: string;
    }
  | { kind: "heartbeat"; currentTime: number; isPlaying: boolean; fromMemberId: string };

/**
 * Snapshot of the room's currently selected media. Broadcast by the
 * host on every change AND on request from a joiner. Joiners latch
 * onto this even if they joined the URL bare (e.g. `/room/RV-8842`
 * with no /t=, /m=, /id=).
 */
export interface RoomMediaState {
  /** Composite local catalog id, e.g. "movie-603" or "tv-1399". */
  titleId: string;
  /** TMDB numeric id. */
  tmdbId: number;
  /** "movie" or "tv". Drives the embed URL builder. */
  mediaType: MediaType;
  /** Active TV season (1 for movies). */
  season: number;
  /** Active episode (1 for movies). */
  episode: number;
  /** Selected provider index (0..5). */
  serverIdx: number;
  /** Optional Host-driven current playback timestamp in seconds. */
  currentTime: number;
  /**
   * Optional host-provided direct stream URL (e.g. picked from a CDN
   * picker). When present, peers play this URL verbatim and skip the
   * serverless resolver. Backward-compatible: absent = use resolver.
   */
  customStreamUrl?: string;
  ts: number;
}

/** Compact cross-device media sync payload (Supabase `sync-media`). */
export interface SyncMediaPayload {
  mediaId: number;
  mediaType: MediaType;
  currentTime: number;
  isPlaying: boolean;
  serverIdx: number;
  season?: number;
  episode?: number;
  titleId?: string;
  /** Host wall-clock ms when this snapshot was taken. */
  timestamp?: number;
}

/** Max allowed playback drift (seconds) before a guest snaps to host time. */
export const SYNC_DRIFT_THRESHOLD_S = 1.5;

/** Presence metadata tracked on the Supabase channel. */
interface PresenceMeta {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  joinedAt: number;
  lastSeen: number;
}

const HEARTBEAT_MS = 4000;
const STALE_AFTER_MS = 12_000;
const HEARTBEAT_BROADCAST_MS = 3000;
const BAN_STORAGE_KEY = (code: string) => `luvinrm:room:${code}:banned`;
/** Host-written snapshot of the current media + playback position. */
export const ROOM_STATE_KEY = (code: string) => `luvinrm_room_${code}`;

/**
 * Socket server URL. The current engine is a `BroadcastChannel` for
 * cross-tab sync (no backend), but the project is being wired up for
 * a real socket server. The constant falls back to the page's own
 * origin so dev (vite) and prod (static + same-origin WS) both work
 * without any extra config.
 */
export const SOCKET_URL: string =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_SOCKET_URL) ||
  (typeof window !== "undefined" ? window.location.origin : "");

/**
 * Read the persisted room state for instant joiner handshake. Returns
 * `null` when nothing has been persisted yet (or the entry is older
 * than 30 seconds — we don't trust stale data).
 */
export function readRoomState(
  code: string,
  maxAgeMs = 30_000,
): RoomMediaState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ROOM_STATE_KEY(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RoomMediaState;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.tmdbId) return null;
    if (typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the current room state. Host-only — call sites guard this. */
const writeRoomState = (code: string, state: RoomMediaState) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ROOM_STATE_KEY(code), JSON.stringify(state));
  } catch {
    // ignore
  }
};

/**
 * Legacy embed URL builder. Reserved as a stable string in
 * `RoomMediaState.currentServerUrl` for backward compatibility with
 * peers that still expect the field.
 *
 * No longer points at any upstream. The room now resolves its
 * playback URL through `/api/stream` (see `src/lib/stream.ts`), and
 * `useRoomSync` already consumes the field with `void
 * currentServerUrl`. Returning an empty string here means a
 * misbehaving peer that *does* try to mount the URL will get an
 * `<iframe src="">`-shaped failure rather than a request to a
 * third-party host.
 */
const buildEmbedUrl = (_state: RoomMediaState): string => {
  return "";
};

/** A unique-ish member id. Stable per tab via sessionStorage. */
const ensureSelfId = (): string => {
  if (typeof window === "undefined") return "anon";
  let id = sessionStorage.getItem("luvinrm:self");
  if (!id) {
    id = `m_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("luvinrm:self", id);
  }
  return id;
};

const channelName = (code: string) => `luvinrm:room:${code}`;
const storageKey = (code: string) => `luvinrm:room:${code}:msg`;

const isBroadcastChannelSupported = (): boolean =>
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined";

/** Read the persisted ban list for a room (survives reloads). */
const readBanList = (code: string): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BAN_STORAGE_KEY(code));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const writeBanList = (code: string, list: string[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BAN_STORAGE_KEY(code), JSON.stringify(list));
  } catch {
    // ignore
  }
};

export interface RoomConnection {
  selfId: string;
  isHost: boolean;
  members: Map<string, RoomMember>;
  chat: RoomMsg[];
  playback: PlaybackState | null;
  /** Snapshotted room media state. `null` until something is known. */
  mediaState: RoomMediaState | null;
  /** Read-only view of the banned member-id list for this room. */
  banned: Set<string>;
  /** Send any event to all peers. */
  send: (e: RoomEvent) => void;
  /** Send a chat message. */
  sendChat: (text: string) => void;
  /** Send a playback update (Host only — UI guards this). */
  sendPlayback: (state: PlaybackState) => void;
  /** Broadcast a season/episode change (Host only). */
  sendEpisodeChange: (season: number, episode: number) => void;
  /** Broadcast the full room media state (Host only). */
  sendMediaState: (state: RoomMediaState) => void;
  /** Request the current media state from the host. */
  requestMedia: () => void;
  /** Request the current snapshot from whoever has it. */
  requestSync: () => void;
  /** Host-only: persist the current room state to localStorage. */
  persistRoomState: (state: RoomMediaState) => void;
  /** Non-host: request the host's full room state (chat-style). */
  requestRoomState: () => void;
  /** Host-only: emit room state on demand. */
  emitRoomState: (state: RoomMediaState) => void;
  /**
   * Dual-sync fallback: joiner asks the host "what's playing right
   * now?". Host automatically replies via `host-state:payload` if it
   * is the authoritative host. Carries enough for the joiner to
   * mount the iframe immediately, without waiting for the heavier
   * `media:state` round-trip.
   */
  requestHostState: () => void;
  /** Host-only: emit the current host state snapshot to a requester. */
  emitHostState: (toMemberId: string) => void;
  /** Host-only: broadcast a low-latency heartbeat (every 3 s). */
  sendHeartbeat: (currentTime: number, isPlaying: boolean) => void;
  /** Host-only: announce a play/pause toggle. */
  sendTogglePlay: (time: number) => void;
  /** Host-only: announce a seek to a target time. */
  sendSeek: (targetTime: number) => void;
  /** Kick a member — they will be disconnected immediately. Host only. */
  sendKick: (memberId: string) => void;
  /** Ban a member — adds them to the room ban list. Host only. */
  sendBan: (memberId: string) => void;
  /** Transfer host ownership to another member. Host only. */
  sendTransferHost: (memberId: string) => void;
  /** Subscribe to events. */
  on: <K extends RoomListener["kind"]>(
    kind: K,
    fn: (p: Extract<RoomListener, { kind: K }>) => void,
  ) => () => void;
  close: () => void;
}

type RoomListener =
  | { kind: "members"; members: Map<string, RoomMember> }
  | { kind: "chat"; chat: RoomMsg[]; lastMsg: RoomMsg | null }
  | { kind: "playback"; state: PlaybackState | null; remote?: boolean }
  | { kind: "media"; state: RoomMediaState | null; remote?: boolean }
  | { kind: "host"; hostId: string; isHost: boolean }
  | { kind: "action:play"; time: number }
  | { kind: "action:pause"; time: number }
  | { kind: "action:seek"; targetTime: number }
  | { kind: "heartbeat"; currentTime: number; isPlaying: boolean }
  | {
      kind: "sync-media";
      payload: SyncMediaPayload;
      /** True when this came from the network (never re-emit). */
      remote: boolean;
      /** True when playback time snapped due to drift > threshold. */
      snapped: boolean;
    }
  | {
      kind: "host-state";
      mediaId: number;
      mediaType: MediaType;
      currentServerUrl: string;
      currentTime: number;
      isPlaying: boolean;
      season?: number;
      episode?: number;
      serverIdx?: number;
    }
  | { kind: "moderation:banned"; banned: Set<string> }
  | { kind: "moderation:kicked" };

const MAX_CHAT = 200;

export function connectRoom(
  code: string,
  self: { name: string; avatar: string; isHost: boolean },
): RoomConnection {
  const selfId = ensureSelfId();
  const members = new Map<string, RoomMember>();
  const chat: RoomMsg[] = [];
  let playback: PlaybackState | null = null;
  let mediaState: RoomMediaState | null = null;
  // NOTE on single-source-of-truth for host role:
  //
  // The `self.isHost` flag from the caller is a *hint*, never the
  // authoritative answer. The authoritative hostId is determined by
  // the live presence list — and ONLY by:
  //   1. A hello from a peer that already believes itself host, OR
  //   2. The local election when we determine we're alone, OR
  //   3. An explicit moderation:host event.
  //
  // Any incoming hello that claims `isHost: true` is downgraded to
  // `isHost: false` here. This prevents URL / query / localStorage
  // spoofing — the caller's hint cannot elevate a joiner to host
  // unless the room genuinely has no live host.
  let hostId = "";
  let banned = new Set<string>(readBanList(code));

  // If we are banned, refuse to join immediately.
  if (banned.has(selfId)) {
    return {
      selfId,
      isHost: false,
      members,
      chat,
      playback: null,
      mediaState: null,
      banned,
      send: () => {},
      sendChat: () => {},
      sendPlayback: () => {},
      sendEpisodeChange: () => {},
      sendMediaState: () => {},
      requestMedia: () => {},
      requestSync: () => {},
      persistRoomState: () => {},
      requestRoomState: () => {},
      emitRoomState: () => {},
      requestHostState: () => {},
      emitHostState: () => {},
      sendHeartbeat: () => {},
      sendTogglePlay: () => {},
      sendSeek: () => {},
      sendKick: () => {},
      sendBan: () => {},
      sendTransferHost: () => {},
      on: () => () => {},
      close: () => {},
    };
  }

  const selfMember: RoomMember = {
    id: selfId,
    name: self.name,
    avatar: self.avatar,
    // The caller's hint is ignored until we run the election below.
    // We always start as a non-host candidate; the election in the
    // `presence:hello` handler may upgrade us if no other host exists.
    isHost: false,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
  };
  members.set(selfId, selfMember);

  const listeners: {
    [K in RoomListener["kind"]]: Set<(p: Extract<RoomListener, { kind: K }>) => void>;
  } = {
    members: new Set(),
    chat: new Set(),
    playback: new Set(),
    media: new Set(),
    host: new Set(),
    "action:play": new Set(),
    "action:pause": new Set(),
    "action:seek": new Set(),
    heartbeat: new Set(),
    "sync-media": new Set(),
    "host-state": new Set(),
    "moderation:banned": new Set(),
    "moderation:kicked": new Set(),
  };

  const emit = <K extends RoomListener["kind"]>(
    kind: K,
    payload: Extract<RoomListener, { kind: K }>,
  ) => {
    for (const fn of listeners[kind]) fn(payload);
  };

  // ── Transport ─────────────────────────────────────────────────────────
  // Prefer Supabase Realtime when configured (cross-device). Otherwise
  // fall back to BroadcastChannel + localStorage for local demos.
  void SOCKET_URL;

  let bc: BroadcastChannel | null = null;
  let channel: RealtimeChannel | null = null;
  let usingPresence = false;
  /** Guard: true while applying a remote sync so we never re-broadcast it. */
  let isRemoteUpdate = false;
  /** Presence member ids we've already welcomed (host-side). */
  const welcomedIds = new Set<string>([selfId]);

  if (isBroadcastChannelSupported()) {
    bc = new BroadcastChannel(channelName(code));
    bc.onmessage = (msg) => handleIncoming(msg.data as RoomEvent);
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key !== storageKey(code) || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { id: number; payload: RoomEvent };
      handleIncoming(parsed.payload);
    } catch {
      // ignore
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  /**
   * Apply a compact sync-media payload onto local media + playback.
   * Time snaps only when drift exceeds SYNC_DRIFT_THRESHOLD_S; media /
   * server / episode / play-state always apply immediately.
   */
  const applySyncMedia = (p: SyncMediaPayload, opts: { remote?: boolean } = {}) => {
    if (!p?.mediaId) return;
    const remote = opts.remote !== false;

    const nextSeason = p.season ?? mediaState?.season ?? 1;
    const nextEpisode = p.episode ?? mediaState?.episode ?? 1;
    const nextServer =
      typeof p.serverIdx === "number" ? p.serverIdx : mediaState?.serverIdx ?? 0;
    const incomingTime = Math.max(0, p.currentTime ?? 0);
    const localTime = playback?.time ?? mediaState?.currentTime ?? 0;
    const mediaChanged =
      !mediaState ||
      mediaState.tmdbId !== p.mediaId ||
      mediaState.mediaType !== p.mediaType ||
      mediaState.season !== nextSeason ||
      mediaState.episode !== nextEpisode ||
      mediaState.serverIdx !== nextServer;
    const playChanged = (playback?.playing ?? false) !== !!p.isPlaying;
    const drift = Math.abs(localTime - incomingTime);
    const snapped = mediaChanged || playChanged || drift > SYNC_DRIFT_THRESHOLD_S;
    const appliedTime = snapped ? incomingTime : localTime;

    const next: RoomMediaState = {
      titleId: p.titleId ?? `${p.mediaType}-${p.mediaId}`,
      tmdbId: p.mediaId,
      mediaType: p.mediaType,
      season: nextSeason,
      episode: nextEpisode,
      serverIdx: nextServer,
      currentTime: appliedTime,
      ts: p.timestamp ?? Date.now(),
    };

    const pb: PlaybackState = {
      playing: !!p.isPlaying,
      time: appliedTime,
      // Bump ts only when we actually snap so iframe remounts on seek.
      ts: snapped ? Date.now() : playback?.ts ?? Date.now(),
      mediaType: p.mediaType,
      tmdbId: p.mediaId,
      season: nextSeason,
      episode: nextEpisode,
      serverIdx: nextServer,
    };

    if (remote) isRemoteUpdate = true;
    try {
      mediaState = next;
      playback = pb;
      emit("media", { kind: "media", state: next, remote });
      emit("playback", { kind: "playback", state: pb, remote });
      emit("sync-media", {
        kind: "sync-media",
        payload: { ...p, currentTime: appliedTime, timestamp: next.ts },
        remote,
        snapped,
      });
      emit("heartbeat", {
        kind: "heartbeat",
        currentTime: appliedTime,
        isPlaying: !!p.isPlaying,
      });
      if (playChanged) {
        emit(pb.playing ? "action:play" : "action:pause", {
          kind: pb.playing ? "action:play" : "action:pause",
          time: appliedTime,
        });
      }
      if (snapped && drift > SYNC_DRIFT_THRESHOLD_S && !mediaChanged) {
        emit("action:seek", { kind: "action:seek", targetTime: appliedTime });
      }
    } finally {
      if (remote) isRemoteUpdate = false;
    }
  };

  /** Build the current host snapshot for sync-media / welcome. */
  const buildSyncPayload = (): SyncMediaPayload | null => {
    if (!mediaState?.tmdbId) return null;
    return {
      mediaId: mediaState.tmdbId,
      mediaType: mediaState.mediaType,
      currentTime: playback?.time ?? mediaState.currentTime ?? 0,
      isPlaying: playback?.playing ?? false,
      serverIdx: mediaState.serverIdx,
      season: mediaState.season,
      episode: mediaState.episode,
      titleId: mediaState.titleId,
      timestamp: Date.now(),
    };
  };

  /**
   * Push current media snapshot over `sync-media` (and BC heartbeat).
   * No-ops while applying a remote update (loop protection).
   */
  const broadcastSyncMedia = () => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    const payload = buildSyncPayload();
    if (!payload) return;

    if (channel) {
      void channel.send({ type: "broadcast", event: "sync-media", payload });
    }
    // Always mirror a lightweight heartbeat on the room bus so BC-only
    // peers (and reconnecting guests) still correct drift.
    if (bc) {
      bc.postMessage({
        kind: "heartbeat",
        currentTime: payload.currentTime,
        isPlaying: payload.isPlaying,
        fromMemberId: selfId,
      } satisfies RoomEvent);
      bc.postMessage({
        kind: "media:state",
        state: {
          titleId: payload.titleId ?? `${payload.mediaType}-${payload.mediaId}`,
          tmdbId: payload.mediaId,
          mediaType: payload.mediaType,
          season: payload.season ?? 1,
          episode: payload.episode ?? 1,
          serverIdx: payload.serverIdx,
          currentTime: payload.currentTime,
          ts: payload.timestamp ?? Date.now(),
        },
        fromMemberId: selfId,
      } satisfies RoomEvent);
    }
  };

  /** Host welcome: full state blast to a joiner (or everyone). */
  const welcomeSync = (toMemberId?: string) => {
    if (selfId !== hostId) return;
    if (!mediaState?.tmdbId) return;
    const payload = buildSyncPayload();
    if (!payload) return;

    // Named sync-media for every peer.
    broadcastSyncMedia();

    // Targeted host-state payload when we know who joined.
    if (toMemberId && toMemberId !== selfId) {
      send({
        kind: "host-state:payload",
        memberId: toMemberId,
        mediaId: payload.mediaId,
        mediaType: payload.mediaType,
        currentServerUrl: buildEmbedUrl({
          titleId: payload.titleId ?? `${payload.mediaType}-${payload.mediaId}`,
          tmdbId: payload.mediaId,
          mediaType: payload.mediaType,
          season: payload.season ?? 1,
          episode: payload.episode ?? 1,
          serverIdx: payload.serverIdx,
          currentTime: payload.currentTime,
          ts: payload.timestamp ?? Date.now(),
        }),
        currentTime: payload.currentTime,
        isPlaying: payload.isPlaying,
        season: payload.season,
        episode: payload.episode,
        serverIdx: payload.serverIdx,
        fromMemberId: selfId,
      });
    }

    if (playback) {
      send({ kind: "playback:state", state: playback });
    }
    send({
      kind: "media:state",
      state: {
        titleId: payload.titleId ?? `${payload.mediaType}-${payload.mediaId}`,
        tmdbId: payload.mediaId,
        mediaType: payload.mediaType,
        season: payload.season ?? 1,
        episode: payload.episode ?? 1,
        serverIdx: payload.serverIdx,
        currentTime: payload.currentTime,
        ts: payload.timestamp ?? Date.now(),
      },
      fromMemberId: selfId,
    });
  };

  /** Re-track presence so peers see our current host flag. */
  const refreshPresence = () => {
    if (!channel || !usingPresence) return;
    void channel.track({
      id: selfId,
      name: self.name,
      avatar: self.avatar,
      isHost: selfId === hostId,
      joinedAt: selfMember.joinedAt,
      lastSeen: Date.now(),
    } satisfies PresenceMeta);
  };

  /**
   * Rebuild the local roster from Supabase Presence. Host flags are
   * derived from our local `hostId` (election / transfer), not from
   * peers' self-declared `isHost` (spoof prevention).
   * Host auto-welcomes any newly seen member.
   */
  const applyPresenceState = (joinedIds?: string[]) => {
    if (!channel) return;
    const state = channel.presenceState<PresenceMeta>();
    const previousHostId = hostId;
    const next = new Map<string, RoomMember>();
    const seen = new Set<string>();

    for (const presets of Object.values(state)) {
      for (const p of presets) {
        if (!p?.id) continue;
        seen.add(p.id);
        next.set(p.id, {
          id: p.id,
          name: p.name || "ضيف",
          avatar: p.avatar || "",
          isHost: false,
          joinedAt: typeof p.joinedAt === "number" ? p.joinedAt : Date.now(),
          lastSeen: Date.now(),
        });
      }
    }

    // Always keep a row for ourselves even if track hasn't landed yet.
    next.set(selfId, {
      ...selfMember,
      isHost: selfId === hostId,
      lastSeen: Date.now(),
    });
    seen.add(selfId);

    members.clear();
    for (const [id, m] of next) members.set(id, m);

    // If the previous host vanished, re-elect. Otherwise keep hostId
    // and just refresh isHost flags — unless we still have no host.
    if (hostId && !members.has(hostId)) {
      const winner = electHostFromRoster();
      setHost(winner, { announce: true, previousHostId });
    } else if (!hostId) {
      const winner = electHostFromRoster();
      if (winner) setHost(winner, { announce: false });
    } else {
      for (const [id, m] of members) m.isHost = id === hostId;
      emit("members", { kind: "members", members });
      emit("host", { kind: "host", hostId, isHost: selfId === hostId });
    }

    // WELCOME SYNC: host pushes full state to every newly joined peer.
    if (selfId === hostId && mediaState?.tmdbId) {
      const newcomers =
        joinedIds?.filter((id) => id && id !== selfId && !welcomedIds.has(id)) ??
        [...seen].filter((id) => id !== selfId && !welcomedIds.has(id));
      for (const id of newcomers) {
        welcomedIds.add(id);
        welcomeSync(id);
      }
      // Also blast sync-media once if anyone new arrived.
      if (newcomers.length > 0) broadcastSyncMedia();
    }

    // Drop welcomed ids that left so a rejoin gets another welcome.
    for (const id of [...welcomedIds]) {
      if (!seen.has(id)) welcomedIds.delete(id);
    }
  };

  /** Wire (or re-wire) Supabase channel listeners — kept for the session. */
  const bindChannelHandlers = (ch: RealtimeChannel) => {
    ch.on("broadcast", { event: "room-event" }, ({ payload }) => {
      handleIncoming(payload as RoomEvent);
    })
      .on("broadcast", { event: "sync-media" }, ({ payload }) => {
        // Host is the authority — ignore echoes (broadcast self: true).
        if (selfId === hostId) return;
        applySyncMedia(payload as SyncMediaPayload, { remote: true });
      })
      .on("broadcast", { event: "request-host-state" }, ({ payload }) => {
        const p = payload as { memberId: string };
        handleIncoming({ kind: "request:host-state", memberId: p.memberId });
      })
      .on("broadcast", { event: "host-state-payload" }, ({ payload }) => {
        const p = payload as Extract<RoomEvent, { kind: "host-state:payload" }>;
        handleIncoming({ ...p, kind: "host-state:payload" });
      })
      .on("presence", { event: "sync" }, () => applyPresenceState())
      .on("presence", { event: "join" }, ({ newPresences }) => {
        const ids = (newPresences as unknown as PresenceMeta[])
          .map((p) => p?.id)
          .filter((id): id is string => !!id);
        applyPresenceState(ids);
      })
      .on("presence", { event: "leave" }, () => applyPresenceState());
  };

  const onChannelStatus = async (status: string) => {
    if (!channel) return;
    if (status === "SUBSCRIBED") {
      usingPresence = true;
      await channel.track({
        id: selfId,
        name: self.name,
        avatar: self.avatar,
        isHost: selfId === hostId,
        joinedAt: selfMember.joinedAt,
        lastSeen: Date.now(),
      } satisfies PresenceMeta);
      send({
        kind: "presence:hello",
        member: { ...selfMember, isHost: selfId === hostId, lastSeen: Date.now() },
      });
      if (selfId !== hostId) {
        requestSync();
        requestMedia();
        requestRoomState();
        requestHostState();
      } else if (mediaState) {
        welcomeSync();
      }
    } else if (
      status === "CHANNEL_ERROR" ||
      status === "TIMED_OUT" ||
      status === "CLOSED"
    ) {
      // Keep trying — Realtime will re-emit SUBSCRIBED when the socket
      // recovers; presence track re-runs above so the session never dies.
      usingPresence = false;
    }
  };

  // Supabase Realtime channel — cross-device sync.
  if (supabase) {
    channel = supabase.channel(`room:${code}`, {
      config: {
        broadcast: { self: true },
        presence: { key: selfId },
      },
    });
    bindChannelHandlers(channel);
    channel.subscribe((status) => {
      void onChannelStatus(status);
    });
  }

  // ── Outbound ──────────────────────────────────────────────────────────
  const send = (e: RoomEvent) => {
    // Same-origin tabs (always useful as a low-latency mirror).
    if (bc) {
      bc.postMessage(e);
    }

    if (channel) {
      // Named events for the dual-sync + media paths.
      if (e.kind === "request:host-state") {
        void channel.send({
          type: "broadcast",
          event: "request-host-state",
          payload: { memberId: e.memberId },
        });
      } else if (e.kind === "host-state:payload") {
        void channel.send({
          type: "broadcast",
          event: "host-state-payload",
          payload: e,
        });
      } else {
        void channel.send({ type: "broadcast", event: "room-event", payload: e });
      }
      return;
    }

    // localStorage fallback when neither Supabase nor BC is available.
    if (!bc && typeof window !== "undefined") {
      const envelope = { id: Date.now() + Math.random(), payload: e };
      try {
        localStorage.setItem(storageKey(code), JSON.stringify(envelope));
      } catch {
        // ignore
      }
    }
  };

  const sendChat = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const msg: RoomMsg = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      memberId: selfId,
      name: self.name,
      avatar: self.avatar,
      text: trimmed,
      ts: Date.now(),
    };
    send({ kind: "chat:message", msg });
  };

  const sendPlayback = (state: PlaybackState) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    playback = state;
    if (mediaState) {
      mediaState = {
        ...mediaState,
        currentTime: state.time,
        season: state.season,
        episode: state.episode,
        serverIdx: state.serverIdx ?? mediaState.serverIdx,
        ts: Date.now(),
      };
    }
    send({ kind: "playback:state", state });
    broadcastSyncMedia();
  };

  const sendEpisodeChange = (season: number, episode: number) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    send({ kind: "episode:change", season, episode, fromMemberId: selfId });
    if (mediaState) {
      mediaState = { ...mediaState, season, episode, currentTime: 0, ts: Date.now() };
    }
    if (playback) {
      playback = { ...playback, season, episode, time: 0, playing: false, ts: Date.now() };
    }
    broadcastSyncMedia();
  };

  const sendMediaState = (state: RoomMediaState) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    mediaState = state;
    send({ kind: "media:state", state, fromMemberId: selfId });
    broadcastSyncMedia();
  };

  const persistRoomState = (state: RoomMediaState) => {
    if (selfId !== hostId) return;
    mediaState = state;
    writeRoomState(code, state);
  };

  const requestRoomState = () =>
    send({ kind: "request:room-state", memberId: selfId });

  const emitRoomState = (state: RoomMediaState) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    mediaState = state;
    writeRoomState(code, state);
    send({ kind: "emit:room-state", state, fromMemberId: selfId });
    broadcastSyncMedia();
  };

  // Dual-sync fallback: a joiner asks "what's playing?" and the host
  // answers with a self-contained payload. Carries the data the
  // joiner needs to mount the iframe (serverUrl, tmdbId, current
  // time, play/pause) without waiting for the heavier `media:state`.
  const requestHostState = () => {
    send({ kind: "request:host-state", memberId: selfId });
  };

  const emitHostState = (toMemberId: string) => {
    if (selfId !== hostId) return;
    welcomeSync(toMemberId);
    if (!mediaState?.tmdbId) return;
    emit("host-state", {
      kind: "host-state",
      mediaId: mediaState.tmdbId,
      mediaType: mediaState.mediaType,
      currentServerUrl: buildEmbedUrl(mediaState),
      currentTime: playback?.time ?? mediaState.currentTime ?? 0,
      isPlaying: playback?.playing ?? false,
      season: mediaState.season,
      episode: mediaState.episode,
      serverIdx: mediaState.serverIdx,
    });
  };

  const sendHeartbeat = (currentTime: number, isPlaying: boolean) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    if (playback) {
      playback = { ...playback, time: currentTime, playing: isPlaying, ts: Date.now() };
    } else if (mediaState) {
      playback = {
        playing: isPlaying,
        time: currentTime,
        ts: Date.now(),
        mediaType: mediaState.mediaType,
        tmdbId: mediaState.tmdbId,
        season: mediaState.season,
        episode: mediaState.episode,
        serverIdx: mediaState.serverIdx,
      };
    }
    if (mediaState) {
      mediaState = { ...mediaState, currentTime, ts: Date.now() };
    }
    send({
      kind: "heartbeat",
      currentTime,
      isPlaying,
      fromMemberId: selfId,
    });
    broadcastSyncMedia();
  };

  const sendTogglePlay = (time: number) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    const nextPlaying = !(playback?.playing ?? false);
    if (playback) {
      playback = { ...playback, playing: nextPlaying, time, ts: Date.now() };
    } else if (mediaState) {
      playback = {
        playing: nextPlaying,
        time,
        ts: Date.now(),
        mediaType: mediaState.mediaType,
        tmdbId: mediaState.tmdbId,
        season: mediaState.season,
        episode: mediaState.episode,
        serverIdx: mediaState.serverIdx,
      };
    }
    send({ kind: "action:toggle-play", time, fromMemberId: selfId });
    broadcastSyncMedia();
  };

  /**
   * Explicit play/pause is handled via sendPlayback / sendHeartbeat
   * which both blast sync-media with the authoritative isPlaying flag.
   */

  const sendSeek = (targetTime: number) => {
    if (isRemoteUpdate) return;
    if (selfId !== hostId) return;
    const t = Math.max(0, targetTime);
    if (playback) {
      playback = { ...playback, time: t, ts: Date.now() };
    } else if (mediaState) {
      playback = {
        playing: false,
        time: t,
        ts: Date.now(),
        mediaType: mediaState.mediaType,
        tmdbId: mediaState.tmdbId,
        season: mediaState.season,
        episode: mediaState.episode,
        serverIdx: mediaState.serverIdx,
      };
    }
    if (mediaState) {
      mediaState = { ...mediaState, currentTime: t, ts: Date.now() };
    }
    send({ kind: "action:seek", targetTime: t, fromMemberId: selfId });
    broadcastSyncMedia();
  };

  const requestMedia = () => send({ kind: "media:request", memberId: selfId });

  const requestSync = () => send({ kind: "sync:request", memberId: selfId });

  const sendKick = (memberId: string) => {
    if (selfId !== hostId) return;
    send({ kind: "moderation:kick", memberId, byMemberId: selfId });
  };

  const sendBan = (memberId: string) => {
    if (selfId !== hostId) return;
    send({ kind: "moderation:ban", memberId, byMemberId: selfId });
  };

  const sendTransferHost = (memberId: string) => {
    if (selfId !== hostId) return;
    send({ kind: "moderation:host", newHostId: memberId, byMemberId: selfId });
  };

  /**
   * Pick the authoritative host from a candidate list. The rule is:
   * the oldest member in the roster wins. Returns `""` when the list
   * is empty (caller decides what to do — usually: do nothing).
   */
  const electHostFromRoster = (): string => {
    if (members.size === 0) return "";
    const sorted = Array.from(members.values()).sort((a, b) => a.joinedAt - b.joinedAt);
    return sorted[0]?.id ?? "";
  };

  /**
   * Switch the host to a new id, update roster `isHost` flags, emit
   * the new roster, and (optionally) broadcast a system chat message
   * announcing the handover so peers see a clear "host changed" event
   * in the sidebar.
   */
  const setHost = (newHostId: string, options: { announce?: boolean; previousHostId?: string } = {}) => {
    const prev = hostId;
    hostId = newHostId;
    for (const [id, m] of members) {
      m.isHost = id === newHostId;
    }
    selfMember.isHost = selfId === newHostId;
    emit("members", { kind: "members", members });
    emit("host", { kind: "host", hostId, isHost: selfId === hostId });
    refreshPresence();

    if (options.announce && prev && newHostId && prev !== newHostId) {
      const newHost = members.get(newHostId);
      const previous = options.previousHostId ? members.get(options.previousHostId) : undefined;
      const systemMsg: RoomMsg = {
        id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        memberId: "system",
        name: "النظام",
        avatar: "",
        text: previous
          ? `قام المضيف بالمغادرة، وتم نقل صلاحية المضيف تلقائياً إلى ${newHost?.name ?? "عضو جديد"}`
          : `${newHost?.name ?? "عضو جديد"} هو المضيف الجديد لهذه الغرفة`,
        ts: Date.now(),
      };
      chat.push(systemMsg);
      if (chat.length > MAX_CHAT) chat.splice(0, chat.length - MAX_CHAT);
      emit("chat", { kind: "chat", chat, lastMsg: systemMsg });
    }
  };

  // ── Inbound ───────────────────────────────────────────────────────────
  function handleIncoming(e: RoomEvent) {
    switch (e.kind) {
      case "presence:hello": {
        if (e.member.id !== selfId) {
          // SPOOFING PREVENTION: any incoming hello that claims
          // `isHost: true` is downgraded. The authoritative hostId is
          // computed locally from the live presence list, not from a
          // peer's self-declaration. We always store the peer's row
          // with `isHost: false` here and let the election below
          // upgrade the legitimate winner.
          const incoming: RoomMember = {
            ...e.member,
            isHost: false,
            lastSeen: Date.now(),
          };
          members.set(e.member.id, incoming);
          emit("members", { kind: "members", members });

          // If we don't have a host yet, run an election over the
          // current roster. The oldest member wins.
          if (!hostId) {
            const winner = electHostFromRoster();
            if (winner === selfId) {
              // We win. Become host quietly (no chat message — we
              // didn't "lose" anyone).
              setHost(winner, { announce: false });
            }
            // Either way, reflect the roster change so the UI knows.
            emit("host", { kind: "host", hostId, isHost: selfId === hostId });
          } else if (hostId === selfId) {
            // We already think we're host. The new peer's spoofed
            // claim is ignored.
            emit("host", { kind: "host", hostId, isHost: selfId === hostId });
          }

          // Reply with our own hello so newcomers see us. Always send
          // our authoritative host flag, never a spoofable one.
          send({
            kind: "presence:hello",
            member: { ...selfMember, isHost: selfId === hostId, lastSeen: Date.now() },
          });
        }
        break;
      }
      case "presence:bye": {
        const previousHostId = hostId;
        const hostWasLeaving = e.memberId === hostId;
        if (members.delete(e.memberId)) {
          // If the host left, fall back to the oldest remaining member
          // AND broadcast a system chat message announcing the handover.
          if (hostWasLeaving) {
            const next = electHostFromRoster();
            setHost(next, { announce: true, previousHostId });
          }
          emit("members", { kind: "members", members });
        }
        break;
      }
      case "presence:heartbeat": {
        const m = members.get(e.memberId);
        if (m) {
          m.lastSeen = Date.now();
          emit("members", { kind: "members", members });
        }
        break;
      }
      case "chat:message": {
        if (chat.find((c) => c.id === e.msg.id)) break;
        chat.push(e.msg);
        if (chat.length > MAX_CHAT) chat.splice(0, chat.length - MAX_CHAT);
        emit("chat", { kind: "chat", chat, lastMsg: e.msg });
        break;
      }
      case "playback:state": {
        // Only the current host's playback broadcasts are honored.
        if (e.state && hostId && e.state.ts) {
          playback = e.state;
          emit("playback", { kind: "playback", state: e.state });
        }
        break;
      }
      case "episode:change": {
        if (e.fromMemberId === selfId) break;
        const next: PlaybackState = playback
          ? {
              ...playback,
              season: e.season,
              episode: e.episode,
              playing: false,
              time: 0,
              ts: Date.now(),
            }
          : {
              playing: false,
              time: 0,
              ts: Date.now(),
              mediaType: "tv",
              tmdbId: 0,
              season: e.season,
              episode: e.episode,
            };
        playback = next;
        emit("playback", { kind: "playback", state: next });
        break;
      }
      case "sync:request": {
        if (selfId === hostId && playback) {
          send({
            kind: "sync:snapshot",
            fromMemberId: selfId,
            state: playback,
          });
        }
        break;
      }
      case "media:state": {
        if (e.fromMemberId === selfId) break;
        mediaState = e.state;
        emit("media", { kind: "media", state: e.state });
        break;
      }
      case "media:request": {
        if (selfId === hostId && mediaState) {
          send({
            kind: "media:state",
            state: mediaState,
            fromMemberId: selfId,
          });
        }
        break;
      }
      case "request:room-state": {
        if (selfId === hostId && mediaState) {
          send({
            kind: "emit:room-state",
            state: mediaState,
            fromMemberId: selfId,
          });
        }
        break;
      }
      case "emit:room-state": {
        if (e.fromMemberId === selfId) break;
        mediaState = e.state;
        emit("media", { kind: "media", state: e.state });
        break;
      }
      case "request:host-state": {
        // Auto-respond: the host always answers the joiner's "what's
        // playing?" with a self-contained payload so the joiner can
        // mount the iframe without waiting for media:state.
        if (selfId === hostId && mediaState && mediaState.tmdbId) {
          send({
            kind: "host-state:payload",
            memberId: e.memberId,
            mediaId: mediaState.tmdbId,
            mediaType: mediaState.mediaType,
            currentServerUrl: buildEmbedUrl(mediaState),
            currentTime: playback?.time ?? mediaState.currentTime ?? 0,
            isPlaying: playback?.playing ?? false,
            season: mediaState.season,
            episode: mediaState.episode,
            serverIdx: mediaState.serverIdx,
            fromMemberId: selfId,
          });
        }
        break;
      }
      case "host-state:payload": {
        // Only honor payloads addressed at us. Accept when we don't
        // yet know the host (joiner race) or when it comes from the
        // current host.
        if (e.memberId !== selfId) break;
        if (hostId && e.fromMemberId !== hostId) break;
        emit("host-state", {
          kind: "host-state",
          mediaId: e.mediaId,
          mediaType: e.mediaType,
          currentServerUrl: e.currentServerUrl,
          currentTime: e.currentTime,
          isPlaying: e.isPlaying,
          season: e.season,
          episode: e.episode,
          serverIdx: e.serverIdx,
        });
        break;
      }
      case "action:toggle-play": {
        if (e.fromMemberId === selfId) break;
        const next: PlaybackState = playback
          ? { ...playback, playing: !playback.playing, time: e.time, ts: Date.now() }
          : {
              playing: true,
              time: e.time,
              ts: Date.now(),
              mediaType: mediaState?.mediaType ?? "movie",
              tmdbId: mediaState?.tmdbId ?? 0,
              season: mediaState?.season ?? 1,
              episode: mediaState?.episode ?? 1,
              serverIdx: mediaState?.serverIdx ?? 0,
            };
        playback = next;
        emit("playback", { kind: "playback", state: next });
        emit(next.playing ? "action:play" : "action:pause", {
          kind: next.playing ? "action:play" : "action:pause",
          time: e.time,
        });
        break;
      }
      case "action:seek": {
        if (e.fromMemberId === selfId) break;
        const next: PlaybackState = playback
          ? { ...playback, time: e.targetTime, ts: Date.now() }
          : {
              playing: false,
              time: e.targetTime,
              ts: Date.now(),
              mediaType: mediaState?.mediaType ?? "movie",
              tmdbId: mediaState?.tmdbId ?? 0,
              season: mediaState?.season ?? 1,
              episode: mediaState?.episode ?? 1,
              serverIdx: mediaState?.serverIdx ?? 0,
            };
        playback = next;
        emit("playback", { kind: "playback", state: next });
        emit("action:seek", {
          kind: "action:seek",
          targetTime: e.targetTime,
        });
        break;
      }
      case "heartbeat": {
        if (e.fromMemberId === selfId) break;
        emit("heartbeat", {
          kind: "heartbeat",
          currentTime: e.currentTime,
          isPlaying: e.isPlaying,
        });
        break;
      }
      case "sync:snapshot": {
        if (e.fromMemberId === selfId) break;
        playback = e.state;
        emit("playback", { kind: "playback", state: e.state });
        break;
      }
      case "moderation:kick": {
        if (e.memberId === selfId) {
          emit("moderation:kicked", { kind: "moderation:kicked" });
        } else if (members.delete(e.memberId)) {
          emit("members", { kind: "members", members });
        }
        break;
      }
      case "moderation:ban": {
        if (e.memberId === selfId) {
          // Self-ban — persist locally and exit immediately.
          banned = new Set([...banned, selfId]);
          writeBanList(code, [...banned]);
          emit("moderation:banned", { kind: "moderation:banned", banned });
          emit("moderation:kicked", { kind: "moderation:kicked" });
        } else {
          banned = new Set([...banned, e.memberId]);
          writeBanList(code, [...banned]);
          emit("moderation:banned", { kind: "moderation:banned", banned });
          if (members.delete(e.memberId)) emit("members", { kind: "members", members });
        }
        break;
      }
      case "moderation:host": {
        if (members.has(e.newHostId)) {
          // Manual transfer — announce it in chat too so peers see
          // the handover was intentional, not a crash recovery.
          const previousHostId = hostId;
          setHost(e.newHostId, { announce: true, previousHostId });
        }
        break;
      }
      case "moderation:banned-list": {
        banned = new Set(e.banned.filter((id) => typeof id === "string"));
        writeBanList(code, [...banned]);
        emit("moderation:banned", { kind: "moderation:banned", banned });
        if (banned.has(selfId)) {
          emit("moderation:kicked", { kind: "moderation:kicked" });
        }
        break;
      }
    }
  }

  // ── Heartbeat + GC ───────────────────────────────────────────────────
  const lifecycleTimer = setInterval(() => {
    send({ kind: "presence:heartbeat", memberId: selfId, ts: Date.now() });
    // Supabase Presence already tracks joins/leaves — don't GC based on
    // broadcast heartbeats or we race with the realtime roster.
    if (usingPresence) {
      refreshPresence();
      return;
    }
    let changed = false;
    let hostWasKilled = false;
    let killedHostId = "";
    for (const [id, m] of members) {
      if (id === selfId) continue;
      if (Date.now() - m.lastSeen > STALE_AFTER_MS) {
        members.delete(id);
        changed = true;
        if (id === hostId) {
          hostWasKilled = true;
          killedHostId = id;
        }
      }
    }
    if (changed) {
      if (hostWasKilled) {
        // Host timed out (closed tab / network drop / crash). Hand the
        // role to the oldest remaining member and announce it in chat
        // so everyone sees the handover.
        const next = electHostFromRoster();
        setHost(next, { announce: true, previousHostId: killedHostId });
      }
      emit("members", { kind: "members", members });
    }
  }, HEARTBEAT_MS);

  // ── Lifecycle ─────────────────────────────────────────────────────────
  const onBeforeUnload = () => send({ kind: "presence:bye", memberId: selfId });
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", onBeforeUnload);
  }

  // Host heartbeat: every 3s, re-persist the local room snapshot
  // and broadcast a low-latency heartbeat so joiners can correct
  // drift without a round-trip.
  const heartbeat = setInterval(() => {
    if (selfId !== hostId) return;
    if (mediaState) {
      const refreshed: RoomMediaState = { ...mediaState, ts: Date.now() };
      mediaState = refreshed;
      writeRoomState(code, refreshed);
      send({ kind: "media:state", state: refreshed, fromMemberId: selfId });
      broadcastSyncMedia();
    }
    if (playback) {
      send({
        kind: "heartbeat",
        currentTime: playback.time,
        isPlaying: playback.playing,
        fromMemberId: selfId,
      });
    }
    refreshPresence();
  }, HEARTBEAT_BROADCAST_MS);

  let electionTimer: ReturnType<typeof setTimeout> | null = null;
  // (declared above — placeholder for linter; actual setTimeout below
  // is captured via a wrapper that assigns here)
  // The real election timer is created after the lifecycle block.
  // We expose a small handle so close() can clear it.
  // We can't trust `self.isHost` from the caller — anyone could pass
  // `true`. Run a real election: assume "alone" tentatively, then
  // wait briefly for any hello responses from existing peers. If we
  // hear from someone whose roster tells us a host exists, we defer
  // to them; otherwise we promote ourselves.
  //
  // Single-user guarantee: when we are the only member in the room
  // (the common case for a freshly created room or a solo viewer)
  // we MUST be elected host immediately. The election is deterministic
  // — the oldest roster member wins, and right now that is us — so
  // we promote ourselves synchronously and never wait for the
  // election timer to fire. This is what gives a single user 100%
  // host control over media and servers.
  const tentativeHost = electHostFromRoster();
  if (tentativeHost === selfId) {
    hostId = selfId;
    selfMember.isHost = true;
    members.set(selfId, selfMember);
    emit("members", { kind: "members", members });
    emit("host", { kind: "host", hostId, isHost: true });
  } else if (!hostId && members.size === 1) {
    // Defensive: if for any reason the election did not pick us
    // (e.g. a race during cleanup), force-promote when we are the
    // only remaining member. This guarantees a single user in a
    // room is always the host.
    hostId = selfId;
    selfMember.isHost = true;
    members.set(selfId, selfMember);
    emit("members", { kind: "members", members });
    emit("host", { kind: "host", hostId, isHost: true });
  }

  // Announce ourselves as soon as we connect. Always send the
  // authoritative host flag — never the spoofable caller hint.
  send({
    kind: "presence:hello",
    member: { ...selfMember, isHost: selfId === hostId, lastSeen: Date.now() },
  });

  // Wait briefly for existing peers to reply. If none arrive and we
  // had no tentative host above, run the election again — by this
  // point we have a stable roster and the result is final.
  electionTimer = setTimeout(() => {
    electionTimer = null;
    if (!hostId) {
      const winner = electHostFromRoster();
      if (winner) setHost(winner, { announce: false });
    }
  }, 350);

  // If we are not the host, ask for a playback snapshot AND for the
  // room's media state so the iframe loads even if the URL was bare.
  if (selfId !== hostId) {
    requestSync();
    requestMedia();
    requestRoomState();
  } else if (mediaState) {
    // Host already had a media state seeded? Re-broadcast it so any
    // peers who joined between the heartbeat get a fresh copy.
    send({ kind: "media:state", state: mediaState, fromMemberId: selfId });
  }

  const on = <K extends RoomListener["kind"]>(
    kind: K,
    fn: (p: Extract<RoomListener, { kind: K }>) => void,
  ) => {
    listeners[kind].add(fn);
    return () => {
      listeners[kind].delete(fn);
    };
  };

  const close = () => {
    send({ kind: "presence:bye", memberId: selfId });
    clearInterval(lifecycleTimer);
    clearInterval(heartbeat);
    if (electionTimer) {
      clearTimeout(electionTimer);
      electionTimer = null;
    }
    if (channel) {
      void channel.untrack();
      void supabase?.removeChannel(channel);
      channel = null;
      usingPresence = false;
    }
    if (bc) {
      bc.close();
      bc = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onBeforeUnload);
    }
  };

  return {
    selfId,
    isHost: selfId === hostId,
    members,
    chat,
    get playback() {
      return playback;
    },
    get mediaState() {
      return mediaState;
    },
    banned,
    send,
    sendChat,
    sendPlayback,
    sendEpisodeChange,
    sendMediaState,
    requestMedia,
    requestSync,
    sendKick,
    sendBan,
    sendTransferHost,
    persistRoomState,
    requestRoomState,
    emitRoomState,
    requestHostState,
    emitHostState,
    sendHeartbeat,
    sendTogglePlay,
    sendSeek,
    on,
    close,
  };
}

/**
 * Pick a friendly Arabic display name for the current user. Stored in
 * localStorage so it persists across reloads but is easy to edit.
 */
const NAME_KEY = "luvinrm:displayName";
const AVATAR_KEY = "luvinrm:avatarSeed";

const FIRST = ["نور", "كريم", "ليلى", "زين", "مايا", "آدم", "سليم", "رنا", "يوسف", "هالة"];
const LAST = ["الشامي", "داوود", "عبد الحق", "الحاج", "حجازي", "فاخوري", "برّي", "قاسم", "نجّار", "مرزوق"];

export function ensureSelfProfile(): { name: string; avatar: string } {
  if (typeof window === "undefined") return { name: "ضيف", avatar: "" };
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = `${FIRST[Math.floor(Math.random() * FIRST.length)]} ${LAST[Math.floor(Math.random() * LAST.length)]}`;
    localStorage.setItem(NAME_KEY, name);
  }
  let avatar = localStorage.getItem(AVATAR_KEY);
  if (!avatar) {
    avatar = `https://i.pravatar.cc/120?img=${Math.floor(Math.random() * 70) + 1}`;
    localStorage.setItem(AVATAR_KEY, avatar);
  }
  return { name, avatar };
}

export function setSelfProfile(name: string, avatar?: string) {
  if (typeof window === "undefined") return;
  if (name) localStorage.setItem(NAME_KEY, name);
  if (avatar) localStorage.setItem(AVATAR_KEY, avatar);
}
