/**
 * Socket.IO クライアント接続の管理
 * アプリ全体で1つのSocket接続を共有するシングルトン
 */

import { io, Socket } from "socket.io-client";
import type { AnnouncementUpdatedPayload } from "@/lib/announcement-shared";

// サーバーから受信するメッセージの型
/** メッセージに添付されたファイル情報 */
export interface FileAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface SocketMessage {
  id: string;
  channelId: string;
  content: string;
  isSystem: boolean;
  isPinned: boolean;
  isEdited: boolean;
  createdAt: string;
  author: {
    id: string;
    name: string;
    role: "TEACHER" | "STUDENT";
    avatarUrl: string | null;
  };
  files: FileAttachment[];
  replyTo?: {
    id: string;
    content: string;
    author: { id: string; name: string };
  } | null;
}

export interface DrawStrokePayload {
  channelId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
}

export interface JoinCallResponse {
  ok: boolean;
  message?: string;
  code?: string;
}

export interface SendMessageResponse {
  ok: boolean;
  error?: string;
  message?: SocketMessage;
}

export interface LoadOlderMessagesResponse {
  ok: boolean;
  error?: string;
  messages?: SocketMessage[];
  hasMore?: boolean;
}

export interface ScheduleUpdatedPayload {
  type: "reservation" | "blocked-slot" | "reservation-availability";
  action: "created" | "cancelled" | "changed";
  roomId?: string;
  studentId?: string;
  reservationId?: string;
}

export interface AppNotificationPayload {
  id: string;
  kind: "call_invite" | "message" | "reservation" | "lesson_reminder" | "summary" | "announcement";
  title: string;
  body: string;
  roomId?: string;
  channelId?: string;
  messageId?: string;
  announcementId?: string;
  url: string;
  tag?: string;
  createdAt: string;
}

export type CallAudioMode = 'mic-only' | 'dual';

export type CallInviteStatusResponse = {
  ok: boolean;
  active: boolean;
  callerName?: string;
  callerRole?: 'TEACHER' | 'STUDENT';
  message?: string;
};

// Socket.IOのイベント型定義
export interface ServerToClientEvents {
  auth_error: (data: { message: string }) => void;
  error: (data: { message: string }) => void;
  channel_messages: (data: { channelId: string; messages: SocketMessage[]; hasMore?: boolean }) => void;
  new_message: (message: SocketMessage) => void;
  message_edited: (data: { channelId: string; messageId: string; content: string }) => void;
  message_deleted: (data: { channelId: string; messageId: string }) => void;
  message_pinned: (data: { channelId: string; messageId: string; isPinned: boolean }) => void;
  rooms_updated: (data: { roomId?: string; reason: "message" | "reservation" | "channel" }) => void;
  schedule_updated: (data: ScheduleUpdatedPayload) => void;
  app_notification: (data: AppNotificationPayload) => void;
  announcements_updated: (data: AnnouncementUpdatedPayload) => void;
  // 通話シグナリングイベント
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  'ice-candidate': (candidate: RTCIceCandidateInit) => void;
  'peer-joined': () => void;
  'peer-left': () => void;
  'room-full': () => void;
  'call-replaced': (data: { message: string }) => void;
  'call-audio-mode': (data: { mode: CallAudioMode }) => void;
  'call-invite': (data: { roomId: string; callerName: string; callerRole: string }) => void;
  'call-invite-response': (data: { accepted: boolean; responderName: string }) => void;
  'translated-subtitle': (data: { text: string; final?: boolean }) => void;
  'target-language': (data: { language: string; enabled?: boolean }) => void;
  // YouTube同時視聴イベント
  'youtube-load': (data: { videoId: string }) => void;
  'youtube-play': (data: { time: number }) => void;
  'youtube-pause': (data: { time: number }) => void;
  'youtube-seek': (data: { time: number }) => void;
  'youtube-sync': (data: { videoId: string; time: number; state: number }) => void;
  // ペイント機能
  'draw_stroke': (data: DrawStrokePayload) => void;
  'clear_canvas': () => void;
}

export interface ClientToServerEvents {
  join_channel: (channelId: string) => void;
  send_message: (
    data: { channelId: string; content: string; fileIds?: string[]; replyToId?: string },
    ack?: (response: SendMessageResponse) => void
  ) => void;
  load_older_messages: (
    data: { channelId: string; beforeMessageId: string },
    ack?: (response: LoadOlderMessagesResponse) => void
  ) => void;
  edit_message: (data: { messageId: string; content: string }) => void;
  delete_message: (data: { messageId: string }) => void;
  pin_message: (data: { messageId: string }) => void;
  // 通話シグナリングイベント
  'check-call-access': (roomId: string, ack?: (response: JoinCallResponse) => void) => void;
  'check-call-invite': (roomId: string, ack?: (response: CallInviteStatusResponse) => void) => void;
  'join-call': (roomId: string, ack?: (response: JoinCallResponse) => void) => void;
  'leave-call': () => void;
  'call-audio-mode': (data: { mode: CallAudioMode }) => void;
  offer: (offer: RTCSessionDescriptionInit) => void;
  answer: (answer: RTCSessionDescriptionInit) => void;
  'ice-candidate': (candidate: RTCIceCandidateInit) => void;
  'call-invite': (data: { roomId: string }) => void;
  'call-invite-response': (data: { roomId: string; accepted: boolean }) => void;
  'translated-subtitle': (data: { text: string; final?: boolean }) => void;
  'target-language': (data: { language: string; enabled?: boolean }) => void;
  // YouTube同時視聴イベント
  'youtube-load': (data: { videoId: string }) => void;
  'youtube-play': (data: { time: number }) => void;
  'youtube-pause': (data: { time: number }) => void;
  'youtube-seek': (data: { time: number }) => void;
  'youtube-sync': (data: { videoId: string; time: number; state: number }) => void;
  // ペイント機能
  'draw_stroke': (data: DrawStrokePayload) => void;
  'clear_canvas': (data: { channelId: string }) => void;
}

// シングルトンのSocket接続
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/**
 * Socket.IO接続を取得する（なければ作成）
 * autoConnect: false で作成し、明示的にconnect()を呼ぶ必要がある
 * → ログイン完了後にのみ接続を開始するため
 */
export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      // cookieを自動送信（JWT認証用）
      withCredentials: true,
      // ログイン状態確認後に手動で接続するため、自動接続はしない
      autoConnect: false,
      // 再接続設定
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

/**
 * Socket接続を切断する（ログアウト時に使用）
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
