import { useEffect, useRef, useState, useCallback } from "react";
import {
  connectRoom,
  ensureSelfProfile,
  type PlaybackState,
  type RoomConnection,
  type RoomMediaState,
  type RoomMember,
  type RoomMsg,
} from "../lib/roomSync";

/**
 * Permission gate for the host-only UI surfaces. A solo viewer
 * (alone in the room, or one of the first two to arrive) must always
 * have full host powers — otherwise a freshly created room is
 * permanently locked to a "Waiting for Host" state until a host
 * election propagates. Treat the single-member case as a forced
 * host so the UI never sits on "عضو - متزامِن" for the only person
 * in the room.
 */
export function canControlRoom(
  membersCount: number,
  isHostUser: boolean,
): boolean {
  if (membersCount <= 1) return true;
  return isHostUser;
}

/** Internal alias so the hook can use the same helper without
 *  shadowing its own return value. */
const canControlRoomFn = canControlRoom;

/**
 * React hook that wraps `connectRoom` and exposes reactive state for
 * the RoomPage UI: roster, chat, host playback, identity, and the
 * host moderation controls (kick / ban / transfer).
 *
 *   const {
 *     self, isHost, members, messages, hostState,
 *     sendMessage, broadcastPlay, broadcastPause, broadcastSeek,
 *     broadcastEpisode, kick, ban, transferHost, kicked,
 *   } = useRoomSync(code);
 *
 * `kicked === true` means the local user has been kicked or banned by
 * the host — the UI should redirect them to the home page.
 */
export interface UseRoomSyncResult {
  self: { id: string; name: string; avatar: string };
  isHost: boolean;
  members: RoomMember[];
  messages: RoomMsg[];
  hostState: PlaybackState | null;
  /** Room media state: which title/season/episode server is active. */
  mediaState: RoomMediaState | null;
  /** True once we've heard from at least one peer (or determined we're alone). */
  ready: boolean;
  /** Set of banned member ids in this room (read-only). */
  banned: Set<string>;
  /** Set locally to `true` when the host kicked us. */
  kicked: boolean;
  sendMessage: (text: string) => void;
  broadcastPlay: (time: number) => void;
  broadcastPause: (time: number) => void;
  broadcastSeek: (time: number) => void;
  broadcastEpisode: (season: number, episode: number) => void;
  /** Host-only: broadcast the full room media state. */
  broadcastMedia: (state: RoomMediaState) => void;
  /** Host-only: persist the room state snapshot to localStorage. */
  persistRoomState: (state: RoomMediaState) => void;
  /** Joiner: ask the host for the current room state snapshot. */
  requestRoomState: () => void;
  /** Host-only: emit the room state snapshot to a requesting member. */
  emitRoomState: (state: RoomMediaState) => void;
  /** Joiner: ask the host "what's playing right now?" for instant sync. */
  requestHostState: () => void;
  /** Host-only: emit a self-contained host-state payload to a requester. */
  emitHostState: (toMemberId: string) => void;
  /** Host-only: broadcast a low-latency heartbeat to all joiners. */
  sendHeartbeat: (time: number, playing: boolean) => void;
  /** Host-only: toggle play/pause and broadcast. */
  togglePlay: (time: number) => void;
  /** Host-only: seek to a target time and broadcast. */
  seek: (targetTime: number) => void;
  /** Force-request a fresh snapshot from the host (used on Join). */
  resync: () => void;
  /** Force-request the room media state from the host. */
  requestMedia: () => void;
  /** Host-only: kick a member (the kicked tab will redirect to home). */
  kick: (memberId: string) => void;
  /** Host-only: ban a member (persistent until cleared). */
  ban: (memberId: string) => void;
  /** Host-only: transfer host ownership to another member. */
  transferHost: (memberId: string) => void;
  /**
   * `true` when the local user has full host permissions — either
   * because they are the elected host, or because they are the only
   * person in the room (in which case they automatically get every
   * host capability, even before the host election finishes). Use
   * this for UI gating (server switcher, playback cluster,
   * moderation) instead of `isHost` directly.
   */
  canControlRoom: boolean;
}

export function useRoomSync(code: string): UseRoomSyncResult {
  const profile = useRef(ensureSelfProfile()).current;
  // NOTE: `isHost` defaults to `false`. The authoritative answer is
  // computed inside `connectRoom` from the live presence list — never
  // from the route, query string, or localStorage. This makes role
  // spoofing impossible: even if a joiner tampers with the URL or
  // caches, the engine will overwrite their hint with the real
  // election result.
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [messages, setMessages] = useState<RoomMsg[]>([]);
  const [hostState, setHostState] = useState<PlaybackState | null>(null);
  const [mediaState, setMediaState] = useState<RoomMediaState | null>(null);
  const [ready, setReady] = useState(false);
  const [banned, setBanned] = useState<Set<string>>(new Set());
  const [kicked, setKicked] = useState(false);
  const connRef = useRef<RoomConnection | null>(null);
  const selfIdRef = useRef<string>("");

  useEffect(() => {
    if (!code) return;
    const conn = connectRoom(code, {
      name: profile.name,
      avatar: profile.avatar,
      // We pass `isHost: false` here unconditionally. The engine's
      // election determines the real value and emits it via the
      // "host" listener below. This makes URL / query-string spoofing
      // impossible — there's no input from the caller that can elevate
      // a joiner to host.
      isHost: false,
    });
    connRef.current = conn;
    selfIdRef.current = conn.selfId;

    // If we were already banned, surface that and refuse to participate.
    if (conn.banned.size > 0) {
      setBanned(new Set(conn.banned));
    }

    const offMembers = conn.on("members", ({ members }) => {
      const arr = Array.from(members.values()).sort((a, b) => a.joinedAt - b.joinedAt);
      setMembers(arr);
      setReady(true);
    });

    const offChat = conn.on("chat", ({ chat }) => {
      setMessages(chat);
    });

    const offPlayback = conn.on("playback", ({ state }) => {
      setHostState(state);
    });

    const offMedia = conn.on("media", ({ state }) => {
      setMediaState(state);
    });

    const offHostState = conn.on(
      "host-state",
      ({
        mediaId,
        mediaType: mType,
        currentServerUrl,
        currentTime,
        isPlaying,
        season: mSeason,
        episode: mEpisode,
        serverIdx: mServerIdx,
      }) => {
        setHostState({
          playing: isPlaying,
          time: currentTime,
          ts: Date.now(),
          mediaType: mType,
          tmdbId: mediaId,
          season: mSeason ?? 1,
          episode: mEpisode ?? 1,
          serverIdx: mServerIdx ?? 0,
        });
        setMediaState((prev) =>
          prev
            ? {
                ...prev,
                tmdbId: mediaId,
                mediaType: mType,
                season: mSeason ?? prev.season,
                episode: mEpisode ?? prev.episode,
                serverIdx: mServerIdx ?? prev.serverIdx,
                currentTime,
                ts: Date.now(),
              }
            : prev,
        );
        // Touch the URL so the joiner's address bar reflects the
        // resolved session immediately, even before the full
        // media:state round-trip lands.
        try {
          const compositeId = `${mType}-${mediaId}`;
          const desired = `#/room/${code}/t=${compositeId}/m=${mType}/id=${mediaId}`;
          if (
            typeof window !== "undefined" &&
            window.location.hash !== desired
          ) {
            window.history.replaceState(null, "", desired);
          }
        } catch {
          /* ignore */
        }
        // The currentServerUrl from the host is not consumed here —
        // the UI builds the embed from the provider chain. It is kept
        // on the listener shape so a future "host-direct" mode can
        // bypass the chain and use the host's chosen URL.
        void currentServerUrl;
      },
    );

    const offHost = conn.on("host", ({ isHost: amHost }) => {
      setIsHost(amHost);
    });

    const offBanned = conn.on("moderation:banned", ({ banned: list }) => {
      setBanned(new Set(list));
    });

    const offKicked = conn.on("moderation:kicked", () => {
      setKicked(true);
    });

    return () => {
      offMembers();
      offChat();
      offPlayback();
      offMedia();
      offHostState();
      offHost();
      offBanned();
      offKicked();
      conn.close();
      connRef.current = null;
    };
  }, [code, profile.avatar, profile.name]);

  const sendMessage = useCallback((text: string) => {
    connRef.current?.sendChat(text);
  }, []);

  const broadcastPlay = useCallback(
    (time: number) => {
      const conn = connRef.current;
      if (!conn || !hostState) return;
      const next: PlaybackState = {
        ...hostState,
        playing: true,
        time,
        ts: Date.now(),
      };
      setHostState(next);
      conn.sendPlayback(next);
    },
    [hostState],
  );

  const broadcastPause = useCallback(
    (time: number) => {
      const conn = connRef.current;
      if (!conn || !hostState) return;
      const next: PlaybackState = {
        ...hostState,
        playing: false,
        time,
        ts: Date.now(),
      };
      setHostState(next);
      conn.sendPlayback(next);
    },
    [hostState],
  );

  const broadcastSeek = useCallback(
    (time: number) => {
      const conn = connRef.current;
      if (!conn || !hostState) return;
      const next: PlaybackState = {
        ...hostState,
        time,
        ts: Date.now(),
      };
      setHostState(next);
      conn.sendPlayback(next);
    },
    [hostState],
  );

  const broadcastEpisode = useCallback(
    (season: number, episode: number) => {
      const conn = connRef.current;
      if (!conn) return;
      setHostState((prev) => {
        const base: PlaybackState = prev ?? {
          playing: false,
          time: 0,
          ts: Date.now(),
          mediaType: "tv",
          tmdbId: 0,
          season,
          episode,
        };
        const next: PlaybackState = {
          ...base,
          season,
          episode,
          playing: false,
          time: 0,
          ts: Date.now(),
        };
        conn.sendPlayback(next);
        return next;
      });
      conn.sendEpisodeChange(season, episode);
    },
    [],
  );

  const resync = useCallback(() => {
    connRef.current?.requestSync();
  }, []);

  const requestMedia = useCallback(() => {
    connRef.current?.requestMedia();
  }, []);

  const broadcastMedia = useCallback((state: RoomMediaState) => {
    connRef.current?.sendMediaState(state);
  }, []);

  const persistRoomState = useCallback((state: RoomMediaState) => {
    connRef.current?.persistRoomState(state);
  }, []);

  const requestRoomState = useCallback(() => {
    connRef.current?.requestRoomState();
  }, []);

  const emitRoomState = useCallback((state: RoomMediaState) => {
    connRef.current?.emitRoomState(state);
  }, []);

  const requestHostState = useCallback(() => {
    connRef.current?.requestHostState();
  }, []);

  const emitHostState = useCallback((toMemberId: string) => {
    connRef.current?.emitHostState(toMemberId);
  }, []);

  const sendHeartbeat = useCallback((time: number, playing: boolean) => {
    connRef.current?.sendHeartbeat(time, playing);
  }, []);

  const togglePlay = useCallback((time: number) => {
    connRef.current?.sendTogglePlay(time);
  }, []);

  const seek = useCallback((targetTime: number) => {
    connRef.current?.sendSeek(targetTime);
  }, []);

  const kick = useCallback((memberId: string) => {
    connRef.current?.sendKick(memberId);
  }, []);

  const ban = useCallback((memberId: string) => {
    connRef.current?.sendBan(memberId);
  }, []);

  const transferHost = useCallback((memberId: string) => {
    connRef.current?.sendTransferHost(memberId);
  }, []);

  // Permission gate: a solo viewer always has full host control,
  // even before the host election propagates. Use this for UI
  // surfaces (server switcher, playback cluster, moderation).
  const canControlRoom = canControlRoomFn(members.length, isHost);

  return {
    self: { id: selfIdRef.current || "self", name: profile.name, avatar: profile.avatar },
    isHost,
    members,
    messages,
    hostState,
    mediaState,
    ready,
    banned,
    kicked,
    sendMessage,
    broadcastPlay,
    broadcastPause,
    broadcastSeek,
    broadcastEpisode,
    broadcastMedia,
    persistRoomState,
    requestRoomState,
    emitRoomState,
    requestHostState,
    emitHostState,
    sendHeartbeat,
    togglePlay,
    seek,
    resync,
    requestMedia,
    kick,
    ban,
    transferHost,
    canControlRoom,
  };
}
