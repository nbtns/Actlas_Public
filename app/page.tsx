'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { getSocket, type AppNotificationPayload, type SocketMessage } from '@/lib/socket';
import BookingView from './components/BookingView';
import TeacherBookingView from './components/TeacherBookingView';
import FirstLoginModal from './components/FirstLoginModal';
import DashboardView from './components/DashboardView';
import LessonView from './components/LessonView';
import GuideView from './components/GuideView';
import DashboardStatsView from './components/DashboardStatsView';
import TeacherSettingsView from './components/TeacherSettingsView';
import AnnouncementsView from './components/AnnouncementsView';
import YouTubePlayer from './components/YouTubePlayer';
import AnnotationViewer from './components/AnnotationViewer';
import { AI_DISABLED_MESSAGE, PUBLIC_DEMO } from '@/lib/public-demo';
import {
  localizeReservationSystemMessage,
  localizeReservationSystemMessagePreview,
} from '@/lib/reservation-messages';
import {
  IconSearch, IconPlus, IconVideo,
  IconPaperclip, IconSend, IconBot,
  IconMegaphone, IconLogout, IconLock, ChannelIcon,
  IconX, IconFile, IconDownload,
  IconPencil, IconCopy, IconReply, IconPin, IconPinOff, IconLink, IconTrash2, IconChat, IconSettings,
  IconChevronDown, IconChevronRight, IconChevronLeft, IconCalendar,
  IconMenu, IconGlobe, IconActivity, IconUsers
} from './Icons';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

/** アイコンピッカーの選択肢（Lucide 100種類厳選） */
const CURATED_ICONS = [
  'hash', 'message_circle', 'message_square', 'music', 'mic', 'headphones', 'video', 'camera', 'image', 'file_text',
  'folder', 'users', 'user', 'calendar', 'bell', 'settings', 'search', 'link', 'map', 'mail',
  'phone', 'book', 'edit', 'trash', 'lock', 'unlock', 'key', 'shield', 'info', 'help_circle',
  'play', 'pause', 'square', 'circle', 'triangle', 'cloud', 'sun', 'moon', 'wind', 'droplet',
  'flame', 'zap', 'activity', 'battery', 'bluetooth', 'wifi', 'cast', 'monitor', 'smartphone', 'tablet',
  'watch', 'speaker', 'radio', 'tv', 'keyboard', 'mouse', 'printer', 'pen_tool', 'scissors', 'paperclip',
  'clipboard', 'archive', 'box', 'package', 'briefcase', 'coffee', 'shopping_cart', 'gift', 'truck', 'plane',
  'car', 'bus', 'bike', 'navigation', 'map_pin', 'compass', 'anchor', 'flag', 'target', 'crosshair',
  'award', 'crown', 'medal', 'thumbs_up', 'thumbs_down', 'send', 'share', 'download', 'upload', 'refresh_cw',
  'plus', 'minus', 'x', 'check'
] as const;

/** ログイン中のユーザー情報の型 */
interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'TEACHER' | 'STUDENT';
  avatarUrl: string | null;
  isFirstLogin?: boolean;
  notificationsEnabled?: boolean;
  language?: string;
  timezone?: string;
}

/** DBから取得するルームの型 */
interface RoomData {
  id: string;
  name: string;
  student: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
  owner: {
    id: string;
    name: string;
  };
  channels: ChannelData[];
  lastMessage: string | null;
  lastMessageAt: string | null;
}

/** DBから取得するチャンネルの型 */
interface ChannelData {
  id: string;
  name: string;
  type: string;
  position: number;
  teacherOnly: boolean;
  icon?: string | null;
}

/** チャンネルの説明文 */
function channelDesc(type: string, lang: string = 'ja'): string {
  if (lang === 'en') {
    const map: Record<string, string> = {
      guide: 'Learn how to use this app',
      chat: 'Daily communication',
      material: 'Share materials, PDFs, and audio',
      lesson_record: 'AI lesson summaries (Teacher only)',
      booking: 'Book or manage lessons',
      youtube: 'Watch YouTube videos together',
      memo: 'Free notes',
      dashboard: 'Student progress & lesson counts (Teacher only)',
      custom: '',
    };
    return map[type.toLowerCase()] || '';
  }
  const map: Record<string, string> = {
    guide: 'このアプリの使い方を確認できます',
    chat: '普段のやりとり',
    material: '教材・PDF・音声ファイルの共有',
    lesson_record: 'レッスンのAI要約が自動投稿されます（先生専用）',
    booking: 'レッスンの予約・変更',
    youtube: 'YouTubeの動画を一緒に視聴します',
    memo: '自由にメモを書けるノート帳',
    dashboard: '生徒の進捗管理・レッスン回数（先生専用）',
    custom: '',
  };
  return map[type.toLowerCase()] || '';
}

function buildTranslationCacheKey(messageId: string, content: string, language: string = 'ja'): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = Math.imul(hash ^ content.charCodeAt(i), 16777619);
  }
  return `actlas_trans_v2_${messageId}_${language}_${(hash >>> 0).toString(36)}`;
}

/** チャンネルの表示名（英語対応） */
function getLocalizedChannelName(name: string, type: string, lang: string = 'ja'): string {
  if (lang === 'en') {
    const t = type.toLowerCase();
    if (t === 'chat' || name === 'チャット') return 'Chat';
    if (t === 'material' || name === '教材') return 'Materials';
    if (t === 'booking' || name === '予約') return 'Booking';
    if (t === 'youtube' || name === '同時視聴') return 'Watch Together';
    if (t === 'memo' || name === 'メモ') return 'Memo';
    if (t === 'lesson_record' || name === 'レッスン記録') return 'Lesson Record';
    if (t === 'dashboard' || name === 'ダッシュボード') return 'Dashboard';
    if (t === 'guide' || name === '使い方ガイド') return 'Guide';
  }
  return name;
}

/** アバターの色（ユーザーIDからハッシュで生成） */
function avatarColor(userId: string): string {
  const colors = ['#8b5cf6', '#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#ec4899', '#6366f1'];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/** 名前のイニシャル */
function getInitials(name: string): string {
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** 時間フォーマット */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** 日付フォーマット */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 日付フォーマット（フル） */
function formatDateFull(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** ファイルサイズを人間が読みやすい形式に変換 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_CHAT_FILE_SIZE = 20 * 1024 * 1024;
const PREVIEWABLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_CHAT_FILE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/aac", "audio/flac", "audio/m4a",
  "video/mp4", "video/webm",
  "text/plain",
  "application/xml", "text/xml",
  "application/zip", "application/x-zip-compressed", "multipart/x-zip",
]);
const ALLOWED_CHAT_FILE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp",
  "pdf",
  "mp3", "wav", "ogg", "aac", "flac", "m4a",
  "mp4", "webm",
  "txt", "xml", "zip",
]);
const GENERIC_CHAT_FILE_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function isPreviewableImage(mimeType: string): boolean {
  return PREVIEWABLE_IMAGE_TYPES.has(mimeType);
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function getPendingFileError(file: File, language: string): string | undefined {
  const type = file.type.toLowerCase();
  const extension = getFileExtension(file.name);

  if (file.size > MAX_CHAT_FILE_SIZE) {
    return language === 'en'
      ? `File is too large. Maximum size is ${formatFileSize(MAX_CHAT_FILE_SIZE)}.`
      : `ファイルが大きすぎます。送信できるのは${formatFileSize(MAX_CHAT_FILE_SIZE)}までです。`;
  }

  if (type === "image/svg+xml" || extension === "svg") {
    return language === 'en'
      ? "SVG files cannot be sent for security reasons."
      : "SVGファイルは安全のため送信できません。";
  }

  if (ALLOWED_CHAT_FILE_TYPES.has(type) || (GENERIC_CHAT_FILE_TYPES.has(type) && ALLOWED_CHAT_FILE_EXTENSIONS.has(extension))) {
    return undefined;
  }

  return language === 'en'
    ? "This file type cannot be sent."
    : "このファイル形式は送信できません。";
}

type FileUploadApiResponse = {
  code?: string;
  error?: string;
  file?: {
    id?: string;
  };
};

async function readFileUploadResponse(response: Response): Promise<FileUploadApiResponse> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  try {
    return await response.json();
  } catch {
    return {};
  }
}

function getUploadErrorMessage(status: number, code: string | undefined, language: string): string {
  const isEnglish = language === 'en';

  if (status === 413) {
    return isEnglish
      ? "The upload is over the server limit. Please try a smaller file."
      : "サーバー側のアップロード上限を超えました。より小さいファイルでお試しください。";
  }

  switch (code) {
    case "file-too-large":
      return isEnglish
        ? `File is too large. Maximum size is ${formatFileSize(MAX_CHAT_FILE_SIZE)}.`
        : `ファイルが大きすぎます。送信できるのは${formatFileSize(MAX_CHAT_FILE_SIZE)}までです。`;
    case "unsupported-file-type":
      return isEnglish
        ? "This file type cannot be sent."
        : "このファイル形式は送信できません。";
    case "missing-file":
      return isEnglish
        ? "Please choose a file again."
        : "もう一度ファイルを選び直してください。";
    case "missing-channel":
    case "channel-not-found":
      return isEnglish
        ? "Could not find the destination channel."
        : "送信先のチャンネルが見つかりませんでした。";
    case "unauthorized":
      return isEnglish
        ? "Please sign in again."
        : "もう一度ログインしてください。";
    case "forbidden":
      return isEnglish
        ? "You do not have permission to send files here."
        : "このチャンネルにファイルを送信する権限がありません。";
    default:
      if (status >= 500) {
        return isEnglish
          ? "The server could not upload the file. Please try again."
          : "サーバーでファイルをアップロードできませんでした。もう一度お試しください。";
      }
      return isEnglish
        ? "Could not upload the file. Please try again."
        : "ファイルをアップロードできませんでした。もう一度お試しください。";
  }
}

function getUploadNetworkErrorMessage(language: string): string {
  return language === 'en'
    ? "Network error while uploading. Please check your connection and try again."
    : "アップロード中に通信エラーが発生しました。通信状況を確認してもう一度お試しください。";
}

type PendingFile = {
  file: File;
  localId: string;
  uploading: boolean;
  error?: string;
};

/** アバターを表示するコンポーネント */
function UserAvatar({ user, size = 32 }: { user: { id: string, name: string, avatarUrl: string | null }, size?: number }) {
  if (user.avatarUrl) {
    if (user.avatarUrl.includes(':')) {
      const [color, icon] = user.avatarUrl.split(':');
      return (
        <div style={{ width: size, height: size, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', borderRadius: '50%', overflow: 'hidden', flexShrink: 0 }}>
          <ChannelIcon type={icon} size={size * 0.6} />
        </div>
      );
    } else {
      // アップロードされた画像URLの場合
      return (
        <div style={{ width: size, height: size, background: '#3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
          <Image src={user.avatarUrl} alt={user.name} fill sizes={`${size}px`} style={{ objectFit: 'cover' }} unoptimized />
        </div>
      );
    }
  }
  return (
    <div style={{ width: size, height: size, background: avatarColor(user.id), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', borderRadius: '50%', fontWeight: 'bold', fontSize: size * 0.4, overflow: 'hidden', flexShrink: 0 }}>
      {getInitials(user.name)}
    </div>
  );
}

/** ユーザー名の表示フォーマット（そのまま表示） */
function formatUserName(user: { name: string; role: string }) {
  return user.name;
}

function getPasswordStrengthError(password: string, lang: string) {
  if (password.length < 8) {
    return lang === 'en' ? 'Password must be at least 8 characters' : 'パスワードは8文字以上にしてください';
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return lang === 'en' ? 'Password must include both letters and numbers' : 'パスワードには英字と数字を両方含めてください';
  }
  return '';
}

function secureRandomIndex(length: number) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % length;
}

function generateSecurePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const chars = [
    upper[secureRandomIndex(upper.length)],
    lower[secureRandomIndex(lower.length)],
    digits[secureRandomIndex(digits.length)],
  ];

  while (chars.length < 12) {
    chars.push(all[secureRandomIndex(all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

function buildLoginInfo(language: string, email: string, password: string) {
  return language === 'en'
    ? `■Login Info\nID: ${email}\nPassword: ${password}`
    : `■ログイン情報\nID：${email}\nパスワード：${password}`;
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export default function Home() {
  const router = useRouter();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authCheckError, setAuthCheckError] = useState('');

  // DBから取得したルーム一覧
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsLoadError, setRoomsLoadError] = useState('');
  const [roomsReloadKey, setRoomsReloadKey] = useState(0);

  // 先生用: グローバルページ切り替え（null = 通常のチャット画面、'teacher-booking' = 予約管理ページ、'admin-dashboard' = 料金・売上ダッシュボード）
  const [globalView, setGlobalView] = useState<'announcements' | 'teacher-booking' | 'guide' | 'admin-dashboard' | 'teacher-settings' | null>(null);
  const [inputValue, setInputValue] = useState('');
  
  // インラインPDFプレビュー
  const [activePdfUrl, setActivePdfUrl] = useState<string | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string | null>(null);
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null);

  // 通話状態と着信
  // callActive: 通話セッションが存在するか（WebRTC接続中）
  // showCallUI: 通話画面を前面に表示するか（falseでもcallActiveならバックグラウンドで通話継続）
  // callRoomId: 通話中のルームID（通話画面にroomIdを渡す用）
  const [callActive, setCallActive] = useState(false);
  const [showCallUI, setShowCallUI] = useState(false);
  const [callJoined, setCallJoined] = useState(false);
  const [callRoomId, setCallRoomId] = useState<string | null>(null);
  const [callRoomName, setCallRoomName] = useState<string>('');
  const [incomingCall, setIncomingCall] = useState<{ roomId: string; callerName: string; callerRole: string } | null>(null);

  // 生徒追加モーダルの状態
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({ firstName: '', lastName: '', email: '', password: '', language: 'ja' });
  const [addStudentError, setAddStudentError] = useState('');
  const [studentLoginInfoFallback, setStudentLoginInfoFallback] = useState('');

  // チャンネル追加モーダルの状態
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannel, setNewChannel] = useState({ name: '', type: 'CHAT', icon: 'chat', teacherOnly: false });
  const [addChannelError, setAddChannelError] = useState('');

  // 設定モーダルの状態
  const [showSettings, setShowSettings] = useState(false);
  const AVATAR_COLORS = ['#8b5cf6', '#3b82f6', '#0ea5e9', '#10b981', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#64748b', '#1e293b'];
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [selectedIcon, setSelectedIcon] = useState('smile');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [activeSettingsTab, setActiveSettingsTab] = useState<'name' | 'avatar' | 'language' | 'pwa' | 'danger' | 'email' | 'password' | null>(null);
  const [selectedLang, setSelectedLang] = useState('ja');
  const [selectedTimezone, setSelectedTimezone] = useState('Asia/Tokyo');
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [pwaInstallMessage, setPwaInstallMessage] = useState('');
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [notifiedChannelIds, setNotifiedChannelIds] = useState<Set<string>>(() => new Set());
  const [announcementUnread, setAnnouncementUnread] = useState(false);
  const [unreadNotificationsLoaded, setUnreadNotificationsLoaded] = useState(false);
  const [pendingCallInviteRoomId, setPendingCallInviteRoomId] = useState<string | null>(null);

  // メールアドレス/パスワード変更用
  const [editEmail, setEditEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailChangeCode, setEmailChangeCode] = useState('');
  const [pendingEmailChange, setPendingEmailChange] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credentialError, setCredentialError] = useState('');
  const [credentialSuccess, setCredentialSuccess] = useState('');

  // ユーザー設定モーダルの状態
  const [showUserSettings, setShowUserSettings] = useState(false);
  const [passwordResetNotice, setPasswordResetNotice] = useState('');
  const [passwordResetFallback, setPasswordResetFallback] = useState('');

  // モバイルメニューの開閉状態
  const [mobileMenuOpen, setMobileMenuOpen] = useState<'sidebar' | 'channel' | null>(null);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(null), []);

  // サイドバー・チャンネルパネルの折りたたみ状態
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [channelPanelCollapsed, setChannelPanelCollapsed] = useState(false);

  // 通話中の分割画面モード
  const [splitView, setSplitView] = useState(false);

  const openSettings = () => {
    if (authUser) {
      if (authUser.avatarUrl && authUser.avatarUrl.includes(':')) {
        const [c, i] = authUser.avatarUrl.split(':');
        setSelectedColor(c);
        setSelectedIcon(i);
      }
      setEditName(authUser.name);
      if (authUser.language) setSelectedLang(authUser.language);
      if (authUser.timezone) setSelectedTimezone(authUser.timezone);
    }
    setActiveSettingsTab(null);
    setShowSettings(true);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const iosDeviceTimer = window.setTimeout(() => setIsIosDevice(iosDevice), 0);
    const updateStandaloneState = () => {
      const iosStandalone = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const standalone = standaloneQuery.matches || iosStandalone;
      setIsStandaloneApp(standalone);
      if (standalone) setDeferredInstallPrompt(null);
    };
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
      setPwaInstallMessage('');
    };
    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
      setIsStandaloneApp(true);
      setPwaInstallMessage(selectedLang === 'en' ? 'Actlas is installed.' : 'Actlasをアプリとしてインストールしました。');
    };

    updateStandaloneState();
    standaloneQuery.addEventListener('change', updateStandaloneState);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.clearTimeout(iosDeviceTimer);
      standaloneQuery.removeEventListener('change', updateStandaloneState);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [selectedLang]);

  const handleInstallApp = useCallback(async () => {
    if (isStandaloneApp) {
      setPwaInstallMessage(selectedLang === 'en' ? 'Actlas is already installed.' : 'Actlasはすでにアプリとして開かれています。');
      return;
    }

    if (!deferredInstallPrompt) {
      setPwaInstallMessage(
        isIosDevice
          ? (selectedLang === 'en'
            ? 'On iPhone or iPad, open the Share menu and choose Add to Home Screen.'
            : 'iPhone / iPadでは共有メニューを開き、「ホーム画面に追加」を選んでください。')
          : selectedLang === 'en'
          ? 'In Chrome or Edge, use the install icon on the right side of the address bar.'
          : 'Chrome / Edgeでは、アドレスバー右側のインストールアイコンから追加できます。'
      );
      return;
    }

    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      setDeferredInstallPrompt(null);
      setPwaInstallMessage(
        choice.outcome === 'accepted'
          ? (selectedLang === 'en' ? 'Installation started.' : 'インストールを開始しました。')
          : (selectedLang === 'en' ? 'Installation was canceled.' : 'インストールをキャンセルしました。')
      );
    } catch {
      setPwaInstallMessage(selectedLang === 'en' ? 'Could not start installation.' : 'インストールを開始できませんでした。');
    }
  }, [deferredInstallPrompt, isIosDevice, isStandaloneApp, selectedLang]);

  // Socket.IOフック（リアルタイム通信 – ログイン確認後にのみ接続）
  const isAuthenticated = authUser !== null;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (cancelled) return;
      setPushSupported(supported);

      if (!supported || !isAuthenticated) {
        setPushSubscribed(false);
        return;
      }

      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then(async (subscription) => {
          if (!subscription) return false;
          const statusRes = await fetch('/api/push/subscriptions/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
            cache: 'no-store',
          });
          if (!statusRes.ok) return false;
          const status = await statusRes.json().catch(() => ({}));
          const subscribed = status.subscribed === true;
          if (!subscribed) {
            await subscription.unsubscribe().catch(() => false);
          }
          return subscribed;
        })
        .then((subscribed) => {
          if (!cancelled) setPushSubscribed(subscribed);
        })
        .catch(() => {
          if (!cancelled) setPushSubscribed(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [isAuthenticated]);

  const getServiceWorkerRegistration = useCallback(async () => {
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    }
    return registration;
  }, []);

  const handleEnablePushNotifications = useCallback(async () => {
    if (!pushSupported) {
      setPushMessage(selectedLang === 'en' ? 'This browser does not support notifications.' : 'このブラウザは通知に対応していません。');
      return;
    }

    setPushBusy(true);
    setPushMessage('');
    try {
      const keyRes = await fetch('/api/push/public-key', { cache: 'no-store' });
      const keyData = await keyRes.json().catch(() => ({}));
      if (!keyData.configured || !keyData.publicKey) {
        setPushMessage(selectedLang === 'en' ? 'Push keys are not configured on the server.' : 'サーバー側のPush通知キーが未設定です。');
        return;
      }

      if (Notification.permission === 'denied') {
        setPushMessage(selectedLang === 'en' ? 'Notifications are blocked in this browser.' : 'ブラウザ側で通知がブロックされています。');
        return;
      }

      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushMessage(selectedLang === 'en' ? 'Notification permission was not granted.' : '通知の許可がされませんでした。');
        return;
      }

      const registration = await getServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }

      const saveRes = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!saveRes.ok) throw new Error('SAVE_SUBSCRIPTION_FAILED');

      setPushSubscribed(true);
      setPushMessage(selectedLang === 'en' ? 'This device can receive notifications.' : 'この端末で通知を受け取れるようになりました。');
    } catch (error) {
      console.error('Push notification setup failed:', error);
      setPushMessage(selectedLang === 'en' ? 'Could not enable notifications on this device.' : 'この端末の通知を有効にできませんでした。');
    } finally {
      setPushBusy(false);
    }
  }, [getServiceWorkerRegistration, pushSupported, selectedLang]);

  const handleDisablePushNotifications = useCallback(async () => {
    if (!pushSupported) return;

    setPushBusy(true);
    setPushMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
      }
      setPushSubscribed(false);
      setPushMessage(selectedLang === 'en' ? 'Notifications are off on this device.' : 'この端末の通知を解除しました。');
    } catch (error) {
      console.error('Push notification unsubscribe failed:', error);
      setPushMessage(selectedLang === 'en' ? 'Could not turn off notifications on this device.' : 'この端末の通知を解除できませんでした。');
    } finally {
      setPushBusy(false);
    }
  }, [pushSupported, selectedLang]);

  const handleSendTestPush = useCallback(async () => {
    setPushBusy(true);
    setPushMessage('');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setPushSubscribed(false);
        throw new Error('DEVICE_NOT_REGISTERED');
      }
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'DEVICE_NOT_REGISTERED') setPushSubscribed(false);
        throw new Error(data.error || 'TEST_PUSH_FAILED');
      }
      setPushMessage(selectedLang === 'en' ? 'Test notification sent.' : 'テスト通知を送信しました。');
    } catch (error) {
      console.error('Test push failed:', error);
      setPushMessage(selectedLang === 'en' ? 'Could not send a test notification.' : 'テスト通知を送信できませんでした。');
    } finally {
      setPushBusy(false);
    }
  }, [selectedLang]);

  const { messages, hasMoreMessages, isLoadingOlder, isConnected, sendMessage, loadOlderMessages, editMessage, deleteMessage, pinMessage, disconnect, sendDrawStroke, sendClearCanvas, setDrawCallbacks } = useSocket(activeChannelId, isAuthenticated);
  const markNotificationChannelRead = useCallback(async (channelId: string) => {
    try {
      const response = await fetch('/api/notifications/unread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      if (!response.ok) throw new Error('MARK_NOTIFICATION_READ_FAILED');
    } catch (error) {
      console.error('Notification read state update failed:', error);
    }
  }, []);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const previousMessagesScrollHeightRef = useRef(0);
  const preserveScrollAfterOlderLoadRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  // ファイル添付の状態
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [chatError, setChatError] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // コンテキストメニュー
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; messageId: string; mode: 'context' | 'sheet';
    isOwnMessage: boolean; isPinned: boolean; content: string;
  } | null>(null);

  // 返信モード
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string; content: string } | null>(null);

  // 編集モード
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  // リンクジャンプ用のステート
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);

  // 初回ロード時やURL直接入力時にクエリから取得
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const m = params.get('msg');
      if (m) setTimeout(() => setTargetMessageId(m), 0);

      const callInvite = params.get('callInvite');
      if (callInvite) setTimeout(() => setPendingCallInviteRoomId(callInvite), 0);

      const view = params.get('view');
      if (view === 'teacher-booking' || view === 'admin-dashboard' || view === 'guide' || view === 'teacher-settings') {
        // URLパラメータからの初期ビュー設定（マウント時のみ実行）
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGlobalView(view);
      }
    }
  }, []);

  // メッセージのスクロール処理
  useEffect(() => {
    if (preserveScrollAfterOlderLoadRef.current) {
      const container = messagesContainerRef.current;
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop += container.scrollHeight - previousMessagesScrollHeightRef.current;
        }
        preserveScrollAfterOlderLoadRef.current = false;
        previousMessagesScrollHeightRef.current = 0;
      });
      return;
    }

    if (targetMessageId && messages.some(m => m.id === targetMessageId)) {
      setTimeout(() => {
        const el = document.getElementById(`msg-${targetMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('message--highlight');
          setTimeout(() => el.classList.remove('message--highlight'), 2000);
          setTargetMessageId(null);
        }
      }, 100);
    } else if (!targetMessageId && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, targetMessageId]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    fetch('/api/notifications/unread', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('UNREAD_NOTIFICATIONS_FETCH_FAILED');
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        const channelIds = Array.isArray(data.channelIds)
          ? data.channelIds.filter((value: unknown): value is string => typeof value === 'string')
          : [];
        setNotifiedChannelIds(new Set(channelIds));
        setAnnouncementUnread(Boolean(data.announcementUnread));
        setUnreadNotificationsLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Unread notifications fetch failed:', error);
        setUnreadNotificationsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // 通話招待のリッスン
  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();
    
    const handleCallInvite = (data: { roomId: string; callerName: string; callerRole: string }) => {
      // 自分が参加しているルームへの招待のみ表示
      if (rooms.some(r => r.id === data.roomId)) {
        if (!callActive) {
          setIncomingCall(data);
        }
      }
    };

    socket.on('call-invite', handleCallInvite);
    return () => {
      socket.off('call-invite', handleCallInvite);
    };
  }, [isAuthenticated, callActive, rooms]);

  useEffect(() => {
    if (!pendingCallInviteRoomId || !isAuthenticated || !isConnected || callActive || rooms.length === 0) return;
    const roomId = pendingCallInviteRoomId;
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!room) {
      setTimeout(() => setPendingCallInviteRoomId(null), 0);
      return;
    }

    const socket = getSocket();
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      setPendingCallInviteRoomId(null);
      setChatError(selectedLang === 'en'
        ? 'Could not confirm whether the lesson call is still active.'
        : 'レッスン通話が続いているか確認できませんでした。');
    }, 8000);

    socket.emit('check-call-invite', roomId, (response) => {
      window.clearTimeout(timeoutId);
      if (cancelled) return;
      setPendingCallInviteRoomId(null);

      const url = new URL(window.location.href);
      url.searchParams.delete('callInvite');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);

      if (response.ok && response.active && response.callerName && response.callerRole) {
        setIncomingCall({
          roomId,
          callerName: response.callerName,
          callerRole: response.callerRole,
        });
        return;
      }

      setChatError(selectedLang === 'en'
        ? 'This lesson call has already ended.'
        : 'このレッスン通話はすでに終了しています。');
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [callActive, isAuthenticated, isConnected, pendingCallInviteRoomId, rooms, selectedLang]);

  useEffect(() => {
    if (!activeChannelId || globalView || showCallUI || !unreadNotificationsLoaded) return;
    const timerId = window.setTimeout(() => {
      setNotifiedChannelIds(prev => {
        if (!prev.has(activeChannelId)) return prev;
        const next = new Set(prev);
        next.delete(activeChannelId);
        return next;
      });
      void markNotificationChannelRead(activeChannelId);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [activeChannelId, globalView, markNotificationChannelRead, showCallUI, unreadNotificationsLoaded]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getSocket();

    const handleAppNotification = (notification: AppNotificationPayload) => {
      if (notification.kind === 'announcement') {
        if (globalView !== 'announcements' || showCallUI) {
          fetch('/api/notifications/unread', { cache: 'no-store' })
            .then(async (response) => {
              if (!response.ok) throw new Error('ANNOUNCEMENT_UNREAD_REFRESH_FAILED');
              return response.json();
            })
            .then((data) => setAnnouncementUnread(Boolean(data.announcementUnread)))
            .catch((error) => {
              console.error('Announcement unread refresh failed:', error);
              setAnnouncementUnread(true);
            });
        }
        return;
      }
      const channelId = notification.channelId;
      if (!channelId) return;

      if (channelId === activeChannelId && !globalView && !showCallUI) {
        void markNotificationChannelRead(channelId);
        return;
      }

      setNotifiedChannelIds(prev => {
        if (prev.has(channelId)) return prev;
        const next = new Set(prev);
        next.add(channelId);
        return next;
      });
    };

    socket.on('app_notification', handleAppNotification);
    return () => {
      socket.off('app_notification', handleAppNotification);
    };
  }, [isAuthenticated, activeChannelId, globalView, markNotificationChannelRead, showCallUI]);

  // 通話終了時のAI要約リクエスト送信
  useEffect(() => {
    const handleRequestSummary = async (e: Event) => {
      if (authUser?.role !== 'TEACHER') return;
      if (PUBLIC_DEMO) {
        setChatError(AI_DISABLED_MESSAGE);
        return;
      }
      const customEvent = e as CustomEvent;
      const { transcript, roomId, roomName, duration, language: summaryLanguage } = customEvent.detail;
      
      const room = rooms.find(r => r.id === roomId);
      if (!room) {
        setChatError(selectedLang === 'en' ? 'Could not find the lesson room for the AI summary.' : 'AI要約の投稿先ルームが見つかりませんでした。');
        return;
      }

      const recordChannel = room.channels.find((c: ChannelData) =>
        c.type.toLowerCase() === 'lesson_record' || c.name === 'レッスン記録'
      );
      if (!recordChannel) {
        setChatError(selectedLang === 'en' ? 'Could not find the lesson record channel for the AI summary.' : 'AI要約の投稿先チャンネルが見つかりませんでした。');
        return;
      }

      try {
        // サーバーに要約リクエストを送信。サーバー側で仮メッセージ作成と完了時の更新が行われる
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            roomName,
            duration,
            language: summaryLanguage,
            channelId: recordChannel.id,
            authorId: authUser.id
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setChatError(data.error || (selectedLang === 'en' ? 'Failed to request the AI lesson summary.' : 'AI要約の作成リクエストに失敗しました。'));
        }
      } catch (err) {
        console.error('AI要約リクエストエラー:', err);
        setChatError(selectedLang === 'en' ? 'Network error while requesting the AI lesson summary.' : 'AI要約の作成リクエスト中に通信エラーが発生しました。');
      }
    };

    window.addEventListener('request-lesson-summary', handleRequestSummary);
    return () => window.removeEventListener('request-lesson-summary', handleRequestSummary);
  }, [authUser, rooms, selectedLang]);

  // 内部リンクナビゲーション
  const handleNavigate = useCallback((targetChannelId: string, targetMsgId: string) => {
    window.history.pushState({}, '', `?channel=${targetChannelId}&msg=${targetMsgId}`);
    let foundRoomId: string | null = null;
    for (const room of rooms) {
      if (room.channels.some((c: { id: string }) => c.id === targetChannelId)) {
        foundRoomId = room.id;
        break;
      }
    }
    if (foundRoomId) setActiveRoomId(foundRoomId);
    setActiveChannelId(targetChannelId);
    setTargetMessageId(targetMsgId);
  }, [rooms]);

  // チャンネルIDからチャンネル名を取得
  const getChannelName = useCallback((chId: string) => {
    for (const room of rooms) {
      const ch = room.channels.find((c: { id: string; name: string }) => c.id === chId);
      if (ch) return ch.name;
    }
    return undefined;
  }, [rooms]);

  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    setAuthCheckError('');

    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error('Auth check failed');

      const data = await res.json();
      if (!data.user) throw new Error('Missing user');

      setAuthUser(data.user);
      if (data.user.language) setSelectedLang(data.user.language);
      if (data.user.timezone) {
        setSelectedTimezone(data.user.timezone);
      } else {
        try {
          const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          if (browserTz) setSelectedTimezone(browserTz);
        } catch (_e) {
          // ignore
        }
      }
      setIsLoading(false);
    } catch (error) {
      console.error('Login status check failed:', error);
      setAuthCheckError('network');
      setIsLoading(false);
    }
  }, [router]);

  // ページ読み込み時にログイン状態を確認
  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void checkAuth();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [checkAuth]);

  // ログイン後、ルーム一覧をDBから取得
  useEffect(() => {
    if (!authUser) return;

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      setRoomsLoading(true);
      setRoomsLoadError('');

      fetch('/api/rooms')
        .then(async res => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'ROOMS_FETCH_FAILED');
          return data;
        })
        .then(data => {
          if (cancelled) return;
          const nextRooms = Array.isArray(data.rooms) ? data.rooms : [];
          setRooms(nextRooms);

          if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('view') === 'announcements') {
              setGlobalView('announcements');
              setShowCallUI(false);
            }
          }

          if (nextRooms.length > 0) {
            let defaultRoomId = nextRooms[0].id;
            let defaultChannelId = nextRooms[0].channels[0]?.id;

            if (typeof window !== 'undefined') {
              const params = new URLSearchParams(window.location.search);
              const payment = params.get('payment');
              if (payment) {
                for (const r of nextRooms) {
                  const bookingChannel = r.channels.find((ch: { type: string }) => ch.type === 'booking' || ch.type === 'BOOKING');
                  if (bookingChannel) {
                    defaultRoomId = r.id;
                    defaultChannelId = bookingChannel.id;
                    break;
                  }
                }
              }
              const c = params.get('channel');
              if (!payment && c) {
                for (const r of nextRooms) {
                  if (r.channels.some((ch: { id: string }) => ch.id === c)) {
                    defaultRoomId = r.id;
                    defaultChannelId = c;
                    break;
                  }
                }
              }
            }

            setActiveRoomId(defaultRoomId);
            setActiveChannelId(defaultChannelId || null);
          } else {
            setActiveRoomId(null);
            setActiveChannelId(null);
          }
        })
        .catch(err => {
          if (cancelled) return;
          console.error('ルーム取得エラー:', err);
          setRoomsLoadError('failed');
          setRooms([]);
          setActiveRoomId(null);
          setActiveChannelId(null);
        })
        .finally(() => {
          if (!cancelled) setRoomsLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [authUser, roomsReloadKey]);

  useEffect(() => {
    if (!authUser) return;
    const socket = getSocket();

    const refreshRooms = async () => {
      try {
        const res = await fetch('/api/rooms');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'ROOMS_REFRESH_FAILED');
        if (Array.isArray(data.rooms)) {
          setRooms(data.rooms);
          if (data.rooms.length === 0) {
            setActiveRoomId(null);
            setActiveChannelId(null);
          }
        }
      } catch (err) {
        console.error('ルーム同期エラー:', err);
      }
    };

    const handleRoomsUpdated = () => {
      void refreshRooms();
    };

    socket.on('rooms_updated', handleRoomsUpdated);
    socket.on('schedule_updated', handleRoomsUpdated);
    return () => {
      socket.off('rooms_updated', handleRoomsUpdated);
      socket.off('schedule_updated', handleRoomsUpdated);
    };
  }, [authUser]);

  // ログアウト処理
  const handleLogout = async () => {
    try {
      const registration = 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration()
        : undefined;
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushEndpoint: subscription?.endpoint }),
      });
      if (!response.ok) throw new Error('LOGOUT_FAILED');

      if (subscription) {
        await subscription.unsubscribe().catch(() => false);
      }
      disconnect();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      alert(selectedLang === 'en'
        ? 'Could not log out safely. Please check your connection and try again.'
        : '安全にログアウトできませんでした。通信状態を確認して、もう一度お試しください。');
    }
  };

  // ファイルをサーバーにアップロード（送信ボタンを押したタイミングで実行）
  const uploadFile = useCallback(async (file: File): Promise<{ id?: string; error?: string }> => {
    if (!activeChannelId) {
      return {
        error: selectedLang === 'en'
          ? 'Could not find the destination channel.'
          : '送信先のチャンネルが見つかりません',
      };
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('channelId', activeChannelId);
    try {
      const res = await fetch('/api/files', { method: 'POST', body: formData });
      const data = await readFileUploadResponse(res);
      if (!res.ok) {
        return { error: getUploadErrorMessage(res.status, data.code, selectedLang) };
      }
      if (!data.file?.id) {
        return {
          error: selectedLang === 'en'
            ? 'The upload finished, but the file could not be confirmed. Please choose it again.'
            : 'アップロードは完了しましたが、ファイルを確認できませんでした。もう一度選び直してください。',
        };
      }
      return { id: data.file.id };
    } catch {
      return { error: getUploadNetworkErrorMessage(selectedLang) };
    }
  }, [activeChannelId, selectedLang]);

  // ファイル選択ハンドラー（input[type=file]用、およびペースト用）
  const handleFileSelect = useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).map(file => ({
      file,
      uploading: false,
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      error: getPendingFileError(file, selectedLang),
    }));
    const nextFiles = [...pendingFiles, ...newFiles];
    setPendingFiles(nextFiles);
    const firstError = nextFiles.find(f => f.error)?.error;
    setChatError(firstError || '');
  }, [pendingFiles, selectedLang]);

  // 添付ファイルを削除
  const removePendingFile = useCallback((index: number) => {
    const nextFiles = pendingFiles.filter((_, i) => i !== index);
    setPendingFiles(nextFiles);
    const firstError = nextFiles.find(f => f.error)?.error;
    setChatError(firstError || '');
  }, [pendingFiles]);

  // ドラッグ&ドロップ
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  // メッセージ送信処理（ファイル添付 + 返信対応）
  const handleSendMessage = async () => {
    if (isSendingMessage) return;
    if (!inputValue.trim() && pendingFiles.length === 0) return;
    if (!activeChannelId) return;

    setChatError('');
    const invalidFile = pendingFiles.find(file => file.error);
    if (invalidFile) {
      setChatError(invalidFile.error || (selectedLang === 'en' ? 'Some files cannot be sent.' : '送信できないファイルがあります。'));
      return;
    }
    setIsSendingMessage(true);

    const fileIds: string[] = [];
    for (const pendingFile of pendingFiles) {
      setPendingFiles(prev =>
        prev.map(pf =>
          pf.localId === pendingFile.localId ? { ...pf, uploading: true, error: undefined } : pf
        )
      );

      const result = await uploadFile(pendingFile.file);
      if (!result.id) {
        const error = result.error || (selectedLang === 'en' ? 'Could not upload the file. Please try again.' : 'アップロードに失敗しました');
        await Promise.all(fileIds.map(fileId =>
          fetch(`/api/files/${fileId}`, { method: 'DELETE' }).catch(() => null)
        ));
        setPendingFiles(prev =>
          prev.map(pf =>
            pf.localId === pendingFile.localId ? { ...pf, uploading: false, error } : pf
          )
        );
        setChatError(error);
        setIsSendingMessage(false);
        return;
      }

      fileIds.push(result.id);
      setPendingFiles(prev =>
        prev.map(pf =>
          pf.localId === pendingFile.localId ? { ...pf, uploading: false } : pf
        )
      );
    }

    const result = await sendMessage(
      inputValue,
      fileIds.length > 0 ? fileIds : undefined,
      replyTo?.id
    );

    if (!result.ok) {
      await Promise.all(fileIds.map(fileId =>
        fetch(`/api/files/${fileId}`, { method: 'DELETE' }).catch(() => null)
      ));
      setChatError(result.error || (selectedLang === 'en' ? 'Could not send the message.' : 'メッセージ送信に失敗しました'));
      setIsSendingMessage(false);
      return;
    }

    setInputValue('');
    setPendingFiles([]);
    setReplyTo(null);
    setIsSendingMessage(false);
  };

  const handleLoadOlderMessages = useCallback(async () => {
    const container = messagesContainerRef.current;
    previousMessagesScrollHeightRef.current = container?.scrollHeight ?? 0;
    preserveScrollAfterOlderLoadRef.current = true;

    const result = await loadOlderMessages();
    if (!result.ok) {
      preserveScrollAfterOlderLoadRef.current = false;
      setChatError(result.error || (selectedLang === 'en' ? 'Could not load older messages.' : '過去のメッセージを読み込めませんでした。'));
      return;
    }

    if (!result.messages || result.messages.length === 0) {
      preserveScrollAfterOlderLoadRef.current = false;
    }
  }, [loadOlderMessages, selectedLang]);

  // コンテキストメニューを表示（メッセージを右クリック）
  const handleMessageContextMenu = useCallback((
    e: React.MouseEvent, msg: SocketMessage
  ) => {
    e.preventDefault();
    const pointerType = (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType;
    if (pointerType && pointerType !== 'mouse') return;
    setContextMenu({
      x: e.clientX, y: e.clientY,
      messageId: msg.id,
      mode: 'context',
      isOwnMessage: msg.author.id === authUser?.id,
      isPinned: msg.isPinned,
      content: msg.content,
    });
  }, [authUser?.id]);

  const handleMessageLongPress = useCallback((msg: SocketMessage) => {
    setContextMenu({
      x: 0,
      y: 0,
      messageId: msg.id,
      mode: 'sheet',
      isOwnMessage: msg.author.id === authUser?.id,
      isPinned: msg.isPinned,
      content: msg.content,
    });
  }, [authUser?.id]);

  // 画面クリックでコンテキストメニューを閉じる
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // コンテキストメニューのアクション
  const contextActions = {
    edit: () => {
      if (!contextMenu) return;
      setEditingMessageId(contextMenu.messageId);
      setEditValue(contextMenu.content);
      setContextMenu(null);
      setTimeout(() => editInputRef.current?.focus(), 50);
    },
    copyText: () => {
      if (!contextMenu) return;
      navigator.clipboard.writeText(contextMenu.content);
      setContextMenu(null);
    },
    reply: () => {
      if (!contextMenu) return;
      const msg = messages.find(m => m.id === contextMenu.messageId);
      if (msg) {
        setReplyTo({ id: msg.id, authorName: msg.author.name, content: msg.content });
      }
      setContextMenu(null);
    },
    pin: () => {
      if (!contextMenu) return;
      pinMessage(contextMenu.messageId);
      setContextMenu(null);
    },
    copyLink: () => {
      if (!contextMenu) return;
      const url = `${window.location.origin}?channel=${activeChannelId}&msg=${contextMenu.messageId}`;
      navigator.clipboard.writeText(url);
      setContextMenu(null);
    },
    delete: () => {
      if (!contextMenu) return;
      deleteMessage(contextMenu.messageId);
      setContextMenu(null);
    },
  };

  // 編集確定
  const handleEditConfirm = () => {
    if (!editingMessageId || !editValue.trim()) return;
    editMessage(editingMessageId, editValue);
    setEditingMessageId(null);
    setEditValue('');
  };

  // 編集キャンセル
  const handleEditCancel = () => {
    setEditingMessageId(null);
    setEditValue('');
  };

  // チャンネル追加処理
  const handleAddChannel = async () => {
    setAddChannelError('');
    if (!newChannel.name.trim()) {
      setAddChannelError('チャンネル名を入力してください');
      return;
    }
    const targetRoomId = activeRoomId;
    if (!targetRoomId) {
      setAddChannelError('ルームが選択されていません');
      return;
    }
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: targetRoomId,
          name: newChannel.name.trim(),
          type: newChannel.type,
          icon: newChannel.icon,
          teacherOnly: newChannel.teacherOnly,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddChannelError(data.error || '作成に失敗しました');
        return;
      }
      // 成功→ルーム一覧を再取得して反映
      const roomsRes = await fetch('/api/rooms');
      const roomsData = await roomsRes.json();
      if (roomsData.rooms) {
        setRooms(roomsData.rooms);
        // 新しく追加したチャンネルを自動選択
        if (data.channel) {
          setActiveChannelId(data.channel.id);
        }
      }
      setShowAddChannel(false);
      setNewChannel({ name: '', type: 'CHAT', icon: 'chat', teacherOnly: false });
    } catch {
      setAddChannelError('通信エラーが発生しました');
    }
  };

  // 生徒追加処理
  const handleAddStudent = async () => {
    setAddStudentError('');
    setStudentLoginInfoFallback('');
    if (!newStudent.firstName || !newStudent.lastName || !newStudent.email || !newStudent.password) {
      setAddStudentError('全ての項目を入力してください');
      return;
    }
    const passwordError = getPasswordStrengthError(newStudent.password, selectedLang);
    if (passwordError) {
      setAddStudentError(passwordError);
      return;
    }
    const normalizedEmail = newStudent.email.trim().toLowerCase();
    const fullName = newStudent.language === 'ja' 
      ? `${newStudent.lastName} ${newStudent.firstName}`
      : `${newStudent.firstName} ${newStudent.lastName}`;
    const loginInfo = buildLoginInfo(newStudent.language, normalizedEmail, newStudent.password);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName,
          email: normalizedEmail,
          password: newStudent.password,
          language: newStudent.language
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddStudentError(data.error || '作成に失敗しました');
        return;
      }
      // 成功→ルーム一覧を再取得
      const roomsRes = await fetch('/api/rooms');
      const roomsData = await roomsRes.json();
      if (roomsData.rooms) {
        setRooms(roomsData.rooms);
        // 新しく作ったルームを自動選択
        const newRoom = roomsData.rooms.find((r: RoomData) => r.student.name === fullName);
        if (newRoom) {
          setActiveRoomId(newRoom.id);
          if (newRoom.channels.length > 0) {
            setActiveChannelId(newRoom.channels[0].id);
          }
        }
      }

      try {
        await copyText(loginInfo);
      } catch {
        setStudentLoginInfoFallback(loginInfo);
        setAddStudentError('生徒アカウントは作成されましたが、ログイン情報のコピーだけ失敗しました。下の内容をコピーしてください。');
        return;
      }

      setShowAddStudent(false);
      setNewStudent({ firstName: '', lastName: '', email: '', password: '', language: 'ja' });
    } catch {
      setAddStudentError('通信エラーが発生しました');
    }
  };

  // プロフィール保存処理
  const handleProfileSave = async (overrides?: { color?: string; icon?: string; name?: string; lang?: string; tz?: string }) => {
    setAvatarSaving(true);
    const color = overrides?.color ?? selectedColor;
    const icon = overrides?.icon ?? selectedIcon;
    const newAvatarUrl = `${color}:${icon}`;
    const payload: { avatarUrl: string; name?: string; language?: string; timezone?: string } = { 
      avatarUrl: newAvatarUrl, 
      language: overrides?.lang ?? selectedLang,
      timezone: overrides?.tz ?? selectedTimezone
    };
    const nameToSave = overrides?.name ?? editName;
    if (authUser?.role === 'TEACHER' && nameToSave.trim()) {
      payload.name = nameToSave.trim();
    }
    try {
      const res = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const updatedUser = await res.json();
      setAuthUser(prev => prev ? { ...prev, avatarUrl: updatedUser.avatarUrl, name: updatedUser.name || prev.name, email: updatedUser.email || prev.email, language: updatedUser.language || prev.language, timezone: updatedUser.timezone || prev.timezone } : null);
    } catch {
      alert('保存に失敗しました');
    } finally {
      setAvatarSaving(false);
    }
  };

  // ローディング中は何も表示しない（チラつき防止）
  if (isLoading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#18181b',
      }}>
        <div className="login-form__spinner" style={{
          width: 32, height: 32,
          borderWidth: 3,
        }} />
      </div>
    );
  }

  if (authCheckError && !authUser) {
    return (
      <div className="login-page">
        <div className="login-bg-glow login-bg-glow--1" />
        <div className="login-bg-glow login-bg-glow--2" />
        <div className="login-card">
          <div className="login-card__logo">
            <div className="login-card__logo-icon"><IconGlobe size={28} /></div>
          </div>
          <h1 className="login-card__title">{selectedLang === 'en' ? 'Connection interrupted' : 'サーバーに接続できません'}</h1>
          <p className="login-card__subtitle">
            {selectedLang === 'en'
              ? 'Please check your network and try again. You are not signed out.'
              : 'ネットワークを確認して、もう一度お試しください。ログアウトはしていません。'}
          </p>
          <div className="login-form" style={{ marginTop: 24 }}>
            <button type="button" className="login-form__submit" onClick={() => void checkAuth()}>
              {selectedLang === 'en' ? 'Retry' : '再試行'}
            </button>
            <button
              type="button"
              className="modal__btn modal__btn--cancel"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => router.push('/login')}
            >
              {selectedLang === 'en' ? 'Go to sign in' : 'ログイン画面へ'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 先生か生徒かでビューを切り替え（実際のユーザー権限で自動判定）
  const viewRole = authUser?.role === 'TEACHER' ? 'teacher' : 'student';
  const userName = authUser ? formatUserName(authUser as { name: string; role: string }) : '不明';

  const activeRoom = rooms.find(r => r.id === activeRoomId);
  const activeChannel = activeRoom?.channels.find(c => c.id === activeChannelId);

  // 生徒ビューでは最初のルームを使用
  const studentRoom = rooms[0];

  const openAddStudentModal = () => {
    setAddStudentError('');
    setStudentLoginInfoFallback('');
    setShowAddStudent(true);
  };

  const handleRoomClick = (room: RoomData) => {
    setActiveRoomId(room.id);
    if (room.channels.length > 0) {
      setActiveChannelId(room.channels[0].id);
    }
    setPendingFiles([]); // ルーム切り替え時に添付ファイルをリセット
    setGlobalView(null); // グローバルビューをリセットしてチャット画面に戻る
    // 通話中（実際に接続済み）ならば分割画面に切り替え（通話を維持したまま他チャンネルを表示）
    if (callJoined) {
      setSplitView(true);
      setShowCallUI(true); // 通話映像を右側に表示し続ける
    } else {
      setShowCallUI(false);
    }
    // モバイル: サイドバーを閉じてチャンネルパネルを開く
    setMobileMenuOpen(prev => prev === 'sidebar' ? 'channel' : null);
  };

  const handleChannelClick = (channel: ChannelData) => {
    setActiveChannelId(channel.id);
    setPendingFiles([]); // チャンネル切り替え時に添付ファイルをリセット
    setGlobalView(null); // グローバルビューをリセットしてチャット画面に戻る
    // 通話中（実際に接続済み）ならば分割画面に切り替え（通話を維持したまま他チャンネルを表示）
    if (callJoined) {
      setSplitView(true);
      setShowCallUI(true); // 通話映像を右側に表示し続ける
    } else {
      setShowCallUI(false);
    }
    closeMobileMenu(); // モバイルメニューを閉じる
  };

  return (
    <>
      {/* 接続状態のインジケーター */}
      {!isConnected && (
        <div className="connection-status">
          <div className="connection-status__dot" />
          サーバーに接続中...
        </div>
      )}

      {/* 初回ログインモーダル（生徒用） */}
      {!PUBLIC_DEMO && authUser && authUser.role === 'STUDENT' && authUser.isFirstLogin && (
        <FirstLoginModal 
          user={{ name: authUser.name, isFirstLogin: authUser.isFirstLogin }}
          language={selectedLang} 
          onSave={async (data) => {
            const res = await fetch('/api/users/profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...data, isFirstLogin: false }),
            });
            if (!res.ok) throw new Error('保存に失敗しました');
            const updatedUser = await res.json();
            setAuthUser(prev => prev ? { ...prev, ...updatedUser } : null);
          }}
        />
      )}

      {/* モバイルメニューのオーバーレイ（メニュー外タップで閉じる） */}
      {mobileMenuOpen && (
        <div
          className={`mobile-overlay ${mobileMenuOpen ? 'visible' : ''}`}
          onClick={closeMobileMenu}
        />
      )}

      <div className="app-layout">
        {/* === 左サイドバー（先生のみ表示） === */}
        {viewRole === 'teacher' && (
          <aside className={`sidebar ${mobileMenuOpen === 'sidebar' ? 'mobile-open' : ''} ${sidebarCollapsed ? 'sidebar--collapsed' : ''}`}>
            <div className="sidebar__header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <div className="sidebar__title">
                  <IconGlobe size={22} />
                  Actlas
                </div>
                <button
                  className="sidebar__collapse-btn"
                  onClick={() => setSidebarCollapsed(prev => !prev)}
                  title={sidebarCollapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'}
                >
                  {sidebarCollapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
                </button>
              </div>
              <div className="sidebar__search">
                <span className="sidebar__search-icon">
                  <IconSearch size={14} />
                </span>
                <input className="sidebar__search-input" placeholder={selectedLang === 'en' ? "Search student..." : "生徒を検索..."} />
              </div>
            </div>

            <div className="sidebar__rooms">
              <div className="sidebar__label">{selectedLang === 'en' ? 'Students' : '生徒'} — {rooms.length}{selectedLang === 'en' ? '' : '人'}</div>
              {rooms.map(room => (
                <div
                  key={room.id}
                  className={`room-item ${room.id === activeRoomId ? 'active' : ''}`}
                  onClick={() => handleRoomClick(room)}
                  title={sidebarCollapsed ? formatUserName({ ...room.student, role: 'STUDENT' }) : undefined}
                >
                  <UserAvatar user={room.student} size={36} />
                  <div className="room-item__info">
                    <div className="room-item__name">{formatUserName({ ...room.student, role: 'STUDENT' })}</div>
                  </div>
                  {room.channels.some(ch => notifiedChannelIds.has(ch.id)) && (
                    <span className="room-item__notify-dot" aria-label={selectedLang === 'en' ? 'New notification' : '新しい通知'} />
                  )}
                </div>
              ))}
              <button className="add-room-btn" onClick={openAddStudentModal}>
                <IconPlus size={14} /> {selectedLang === 'en' ? 'Add new student' : '新しい生徒を追加'}
              </button>

            </div>

            <div className="sidebar__profile">
              {authUser && <UserAvatar user={authUser} size={36} />}
              <div className="sidebar__profile-info">
                <div className="sidebar__profile-name">{userName}</div>
              </div>
              <button className="logout-btn" onClick={openSettings} title={selectedLang === 'en' ? "Settings" : "設定"}>
                <IconSettings size={16} />
              </button>
              <button className="logout-btn" onClick={handleLogout} title={selectedLang === 'en' ? "Logout" : "ログアウト"}>
                <IconLogout size={16} />
              </button>
            </div>
          </aside>
        )}

        {/* === チャンネル一覧パネル === */}
        <div className={`channel-panel ${mobileMenuOpen === 'channel' ? 'mobile-open' : ''} ${channelPanelCollapsed ? 'channel-panel--collapsed' : ''}`}>
          <div className="channel-panel__header">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
              <div>
                {viewRole === 'student' ? (
                  <>
                    <div className="channel-panel__room-name">
                      <IconGlobe size={18} /> Actlas
                    </div>
                    <div className="channel-panel__sub">{studentRoom?.channels?.length || 0} {selectedLang === 'en' ? 'Channels' : 'チャンネル'}</div>
                  </>
                ) : (
                  <>
                    <div className="channel-panel__room-name">
                      {activeRoom?.student.name || (selectedLang === 'en' ? 'Select student' : '生徒を選択')}
                    </div>
                    <div className="channel-panel__sub">
                      {activeRoom?.channels.length || 0} {selectedLang === 'en' ? 'Channels' : 'チャンネル'}
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {viewRole === 'teacher' && !channelPanelCollapsed && (
                  <button 
                    className="logout-btn" 
                    onClick={() => {
                      if (!activeRoom) return;
                      setPasswordResetNotice('');
                      setPasswordResetFallback('');
                      setShowUserSettings(true);
                    }}
                    disabled={!activeRoom}
                    title={!activeRoom ? (selectedLang === 'en' ? 'Select a student first' : '先に生徒を追加または選択してください') : (selectedLang === 'en' ? "Settings" : "設定")}
                    style={{ background: 'var(--bg-hover)' }}
                  >
                    <IconSettings size={16} />
                  </button>
                )}
                <button
                  className="channel-panel__collapse-btn"
                  onClick={() => setChannelPanelCollapsed(prev => !prev)}
                  title={channelPanelCollapsed ? 'チャンネルパネルを展開' : 'チャンネルパネルを折りたたむ'}
                >
                  {channelPanelCollapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
                </button>
              </div>
            </div>
          </div>

          {PUBLIC_DEMO && !channelPanelCollapsed && (
            <div style={{ padding: '8px 12px', color: '#a1a1aa', fontSize: 11, lineHeight: 1.5, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              {selectedLang === 'en'
                ? 'Public demo: AI translation and summaries are disabled. The full service includes email verification and first-login setup.'
                : '公開デモではAI翻訳・AI要約を停止しています。本来のサービスではメール認証と初回ログイン設定があります。'}
            </div>
          )}

          <div className="channel-list">
            <div className="channel-list__label">
              <span>{viewRole === 'teacher' ? (selectedLang === 'en' ? 'Broadcast' : '全体') : (selectedLang === 'en' ? 'Announcements' : 'お知らせ')}</span>
            </div>
            <div
              className={`channel-item ${globalView === 'announcements' && !showCallUI ? 'active' : ''}`}
              onClick={() => {
                setGlobalView('announcements');
                setShowCallUI(false);
                setMobileMenuOpen(null);
              }}
            >
              <span className="channel-item__icon"><IconMegaphone size={16} /></span>
              <span className="channel-item__name">
                {viewRole === 'teacher'
                  ? (selectedLang === 'en' ? 'Global announcement' : '全体告知')
                  : (selectedLang === 'en' ? 'Announcements' : 'お知らせ')}
              </span>
              {announcementUnread && (
                <span className="channel-item__unread" aria-label={selectedLang === 'en' ? 'New announcement' : '新しいお知らせ'} />
              )}
            </div>

            <div className="channel-list__label">
              <span>{selectedLang === 'en' ? 'Channels' : 'チャンネル'}</span>
              {viewRole === 'teacher' && (
                <button
                  className="channel-list__add-btn"
                  title={!activeRoom ? (selectedLang === 'en' ? 'Add a student first' : '先に生徒を追加してください') : (selectedLang === 'en' ? 'Add Channel' : 'チャンネルを追加')}
                  onClick={() => {
                    if (!activeRoom) return;
                    setShowAddChannel(true);
                  }}
                  disabled={!activeRoom}
                >
                  <IconPlus size={14} />
                </button>
              )}
            </div>
            {/* 生徒用チャンネル（全員に見える） */}
            {(viewRole === 'student' ? studentRoom : activeRoom)?.channels
              .filter(ch => !ch.teacherOnly && ch.name !== '使い方ガイド')
              .map(ch => (
              <div
                key={ch.id}
                className={`channel-item ${ch.id === activeChannelId && !showCallUI && !globalView ? 'active' : ''}`}
                onClick={() => handleChannelClick(ch)}
              >
                <span className="channel-item__icon">
                  <ChannelIcon type={ch.type} iconName={ch.icon} size={16} />
                </span>
                <span className="channel-item__name">{getLocalizedChannelName(ch.name, ch.type, selectedLang)}</span>
                {notifiedChannelIds.has(ch.id) && (
                  <span className="channel-item__unread" aria-label={selectedLang === 'en' ? 'New notification' : '新しい通知'} />
                )}
              </div>
            ))}

            {/* 先生専用チャンネル（先生にだけ見える） */}
            {viewRole === 'teacher' && activeRoom?.channels.some(ch => ch.teacherOnly) && (
              <>
                <div className="channel-list__label" style={{ marginTop: 8 }}>
                  <span><IconLock size={12} /> {selectedLang === 'en' ? 'Teacher Only' : '先生専用'}</span>
                </div>
                {activeRoom?.channels
                  .filter(ch => ch.teacherOnly)
                  .map(ch => (
                  <div
                    key={ch.id}
                    className={`channel-item ${ch.id === activeChannelId && !showCallUI && !globalView ? 'active' : ''}`}
                    onClick={() => handleChannelClick(ch)}
                  >
                    <span className="channel-item__icon">
                      <ChannelIcon type={ch.type} iconName={ch.icon} size={16} />
                    </span>
                    <span className="channel-item__name">{getLocalizedChannelName(ch.name, ch.type, selectedLang)}</span>
                    {notifiedChannelIds.has(ch.id) && (
                      <span className="channel-item__unread" aria-label={selectedLang === 'en' ? 'New notification' : '新しい通知'} />
                    )}
                  </div>
                ))}
              </>
            )}

          </div>

          {/* 通話中インジケーター（通話中に別チャンネルを見ているとき表示） */}
          {callJoined && !showCallUI && (
            <div
              className="call-active-indicator"
              onClick={() => {
                setSplitView(false);
                setShowCallUI(true);
                setGlobalView(null);
                // 通話中のルームに戻す
                if (callRoomId) setActiveRoomId(callRoomId);
              }}
            >
              <span className="call-active-indicator__dot" />
              <span className="call-active-indicator__text">{selectedLang === 'en' ? 'Call active — Tap to return' : '通話中 — タップで戻る'}</span>
            </div>
          )}

          {/* 下部固定領域：使い方ガイドなど */}
          <div className="channel-panel__bottom-links" style={{ padding: '0 8px 0' }}>
            {/* 先生用: 予約管理ページ */}
            {viewRole === 'teacher' && (
              <div
                className={`channel-item ${globalView === 'teacher-booking' && !showCallUI ? 'active' : ''}`}
                onClick={() => { setGlobalView('teacher-booking'); setShowCallUI(false); }}
                style={{ opacity: 0.85, marginTop: '8px' }}
              >
                <span className="channel-item__icon">
                  <IconCalendar size={16} />
                </span>
                <span className="channel-item__name">{selectedLang === 'en' ? 'Booking' : '予約管理'}</span>
              </div>
            )}

            {/* 先生用: ダッシュボード（利用料・売上） */}
            {viewRole === 'teacher' && (
              <div
                className={`channel-item ${globalView === 'admin-dashboard' && !showCallUI ? 'active' : ''}`}
                onClick={() => { setGlobalView('admin-dashboard'); setShowCallUI(false); }}
                style={{ opacity: 0.85, marginTop: '8px' }}
              >
                <span className="channel-item__icon">
                  <IconActivity size={16} />
                </span>
                <span className="channel-item__name">{selectedLang === 'en' ? 'Sales & Fees' : '利用料・売上'}</span>
              </div>
            )}

            {/* 先生用: 公開ページ設定 */}
            {viewRole === 'teacher' && (
              <div
                className={`channel-item ${globalView === 'teacher-settings' && !showCallUI ? 'active' : ''}`}
                onClick={() => { setGlobalView('teacher-settings'); setShowCallUI(false); }}
                style={{ opacity: 0.85, marginTop: '8px' }}
              >
                <span className="channel-item__icon">
                  <IconSettings size={16} />
                </span>
                <span className="channel-item__name">{selectedLang === 'en' ? 'Profile & Menu Settings' : '公開プロフィール・メニュー設定'}</span>
              </div>
            )}

            {/* 使い方ガイド */}
            <div
              className={`channel-item ${globalView === 'guide' && !showCallUI ? 'active' : ''}`}
              onClick={() => { setGlobalView('guide'); setShowCallUI(false); }}
              style={{ opacity: 0.85, marginTop: '8px' }}
            >
              <span className="channel-item__icon">
                <ChannelIcon type="GUIDE" size={16} />
              </span>
              <span className="channel-item__name">{selectedLang === 'en' ? 'Guide' : '使い方ガイド'}</span>
            </div>
          </div>

          <button
            className={`lesson-btn ${callJoined ? 'lesson-btn--active' : ''}`}
            disabled={!callActive && !activeRoom}
            title={!callActive && !activeRoom ? (selectedLang === 'en' ? 'Add or select a student first' : '先に生徒を追加または選択してください') : undefined}
            onClick={() => {
              if (callActive) {
                // 通話中: フル画面に戻る
                setSplitView(false);
                setShowCallUI(true);
                setGlobalView(null);
                if (callRoomId) setActiveRoomId(callRoomId);
              } else {
                // 新規通話を開始
                const roomId = activeRoomId;
                const room = rooms.find(r => r.id === roomId);
                if (!roomId || !room) return;
                setCallActive(true);
                setShowCallUI(true);
                setSplitView(false);
                setCallRoomId(roomId);
                setCallRoomName(
                  viewRole === 'teacher'
                    ? formatUserName({ name: room.student.name, role: 'STUDENT' })
                    : formatUserName({ name: room.owner?.name || room.name || 'レッスン', role: 'TEACHER' })
                );
                setGlobalView(null);
              }
            }}
          >
            <IconVideo size={16} /> {callJoined ? (selectedLang === 'en' ? 'Return to call' : '通話に戻る') : (selectedLang === 'en' ? 'Start Lesson' : 'レッスンを開始する')}
          </button>

          {/* 生徒ビュー: ログアウトボタン */}
          {viewRole === 'student' && (
            <div className="sidebar__profile" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              {authUser && <UserAvatar user={authUser} size={36} />}
              <div className="sidebar__profile-info">
                <div className="sidebar__profile-name">{userName}</div>
              </div>
              <button className="logout-btn" onClick={openSettings} title={selectedLang === 'en' ? "Settings" : "設定"}>
                <IconSettings size={16} />
              </button>
              <button className="logout-btn" onClick={handleLogout} title={selectedLang === 'en' ? "Logout" : "ログアウト"}>
                <IconLogout size={16} />
              </button>
            </div>
          )}
        </div>

        {/* === チャットエリア === */}
        <main
          className={`chat-panel ${isDragOver ? 'chat-panel--dragover' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 隠しファイル入力 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.mp3,.wav,.ogg,.aac,.flac,.m4a,.mp4,.webm,.txt,.xml,.zip"
            style={{ display: 'none' }}
            onChange={e => { handleFileSelect(e.target.files); e.target.value = ''; }}
          />

          {/* ドラッグオーバー時のオーバーレイ */}
          {isDragOver && (
            <div className="drag-overlay">
              <div className="drag-overlay__content">
                <IconPaperclip size={32} />
                <span>{selectedLang === 'en' ? 'Drop files to upload' : 'ファイルをドロップしてアップロード'}</span>
              </div>
            </div>
          )}

          {/* === コンテンツ＆通話 統合エリア === */}
          <div className={callActive && splitView && showCallUI ? 'split-view' : ''} style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0, overflow: 'hidden', flexDirection: (callActive && splitView && showCallUI) ? 'row' : 'column' }}>
            
            <div 
              className={callActive && splitView && showCallUI ? 'split-view__content' : ''}
              style={{ 
                display: (callActive && showCallUI && !splitView) ? 'none' : 
                         (callActive && splitView && showCallUI) ? 'flex' : 'contents',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <div className="chat-panel__header">
                {viewRole === 'teacher' && (
                  <button
                    className="mobile-menu-btn"
                    onClick={() => setMobileMenuOpen('sidebar')}
                    title={selectedLang === 'en' ? 'Students' : '生徒一覧'}
                    style={{ marginRight: 8 }}
                  >
                    <IconUsers size={20} />
                  </button>
                )}
                <button
                  className="mobile-menu-btn"
                  onClick={() => setMobileMenuOpen('channel')}
                  title={selectedLang === 'en' ? 'Menu' : 'メニュー'}
                >
                  <IconMenu size={20} />
                </button>
                
                {globalView === 'announcements' ? (
                  <>
                    <span className="chat-panel__channel-icon"><IconMegaphone size={18} /></span>
                    <span className="chat-panel__channel-name">
                      {viewRole === 'teacher'
                        ? (selectedLang === 'en' ? 'Global announcement' : '全体告知')
                        : (selectedLang === 'en' ? 'Announcements' : 'お知らせ')}
                    </span>
                  </>
                ) : globalView === 'teacher-booking' ? (
                  <>
                    <span className="chat-panel__channel-icon"><IconCalendar size={18} /></span>
                    <span className="chat-panel__channel-name">{selectedLang === 'en' ? 'Booking' : '予約管理'}</span>
                  </>
                ) : globalView === 'guide' ? (
                  <>
                    <span className="chat-panel__channel-icon"><ChannelIcon type="GUIDE" size={18} /></span>
                    <span className="chat-panel__channel-name">{selectedLang === 'en' ? 'Guide' : '使い方ガイド'}</span>
                  </>
                ) : globalView === 'admin-dashboard' ? (
                  <>
                    <span className="chat-panel__channel-icon"><IconActivity size={18} /></span>
                    <span className="chat-panel__channel-name">{selectedLang === 'en' ? 'Sales & Fees' : '利用料・売上'}</span>
                  </>
                ) : globalView === 'teacher-settings' ? (
                  <>
                    <span className="chat-panel__channel-icon"><IconSettings size={18} /></span>
                    <span className="chat-panel__channel-name">{selectedLang === 'en' ? 'Profile & Menu Settings' : '公開プロフィール・メニュー設定'}</span>
                  </>
                ) : (
                  <>
                    <span className="chat-panel__channel-icon">
                      {activeChannel && <ChannelIcon type={activeChannel.type} iconName={activeChannel.icon} size={18} />}
                    </span>
                    <span className="chat-panel__channel-name">{activeChannel ? getLocalizedChannelName(activeChannel.name, activeChannel.type, selectedLang) : ''}</span>
                    <span className="chat-panel__divider" />
                    <span className="chat-panel__channel-desc">
                      {activeChannel ? channelDesc(activeChannel.type, selectedLang) : ''}
                    </span>
                  </>
                )}
              </div>

              {globalView === 'announcements' ? (
                <AnnouncementsView
                  userRole={authUser?.role || 'STUDENT'}
                  language={selectedLang}
                  onRead={() => setAnnouncementUnread(false)}
                  onUnread={() => setAnnouncementUnread(true)}
                />
              ) : globalView === 'teacher-booking' ? (
                <TeacherBookingView language={selectedLang} timezone={selectedTimezone} />
              ) : globalView === 'guide' ? (
                <GuideView userRole={authUser?.role || 'STUDENT'} language={selectedLang} />
              ) : globalView === 'admin-dashboard' ? (
                <DashboardStatsView language={selectedLang} />
              ) : globalView === 'teacher-settings' ? (
                <TeacherSettingsView language={selectedLang} />
              ) : roomsLoading ? (
                <div className="empty-state">
                  <div className="empty-state__icon"><IconUsers size={40} /></div>
                  <div className="empty-state__title">
                    {selectedLang === 'en' ? 'Loading rooms...' : '生徒ルームを読み込み中です'}
                  </div>
                  <div className="empty-state__desc">
                    {selectedLang === 'en' ? 'Please wait a moment.' : '少しお待ちください。'}
                  </div>
                </div>
              ) : roomsLoadError ? (
                <div className="empty-state">
                  <div className="empty-state__icon"><IconX size={40} /></div>
                  <div className="empty-state__title">
                    {selectedLang === 'en' ? 'Could not load rooms' : '生徒ルームを読み込めませんでした'}
                  </div>
                  <div className="empty-state__desc">
                    {selectedLang === 'en' ? 'Check your connection and try again.' : '通信状況を確認して、もう一度お試しください。'}
                  </div>
                  <button className="modal__btn modal__btn--submit" type="button" onClick={() => setRoomsReloadKey(key => key + 1)}>
                    {selectedLang === 'en' ? 'Retry' : '再読み込み'}
                  </button>
                </div>
              ) : !activeRoom || !activeChannel ? (
                <div className="empty-state">
                  <div className="empty-state__icon"><IconUsers size={40} /></div>
                  <div className="empty-state__title">
                    {viewRole === 'teacher'
                      ? (selectedLang === 'en' ? 'No student room selected' : '生徒ルームがありません')
                      : (selectedLang === 'en' ? 'No lesson room yet' : 'レッスンルームがまだありません')}
                  </div>
                  <div className="empty-state__desc">
                    {viewRole === 'teacher'
                      ? (selectedLang === 'en' ? 'Add a student to start messaging, booking, and lessons.' : '生徒を追加すると、メッセージ・予約・レッスンを始められます。')
                      : (selectedLang === 'en' ? 'Your teacher has not prepared a room for you yet.' : '先生がルームを準備すると、ここに表示されます。')}
                  </div>
                  {viewRole === 'teacher' && (
                    <button className="modal__btn modal__btn--submit" type="button" onClick={openAddStudentModal}>
                      <IconPlus size={14} /> {selectedLang === 'en' ? 'Add new student' : '新しい生徒を追加'}
                    </button>
                  )}
                </div>
              ) : (
                <>

                  {activeChannel.type === 'booking' || activeChannel.type === 'BOOKING' ? (
                    <BookingView
                      userRole={authUser?.role || 'STUDENT'}
                      roomId={activeRoomId || undefined}
                      language={selectedLang}
                      timezone={selectedTimezone}
                    />
                  ) : activeChannel.type === 'dashboard' || activeChannel.type === 'DASHBOARD' ? (
                    <DashboardView
                      studentId={activeRoom.student.id}
                      isTeacher={authUser?.role === 'TEACHER'}
                      onNameChange={(newName) => {
                        if (activeRoomId) {
                          setRooms(prev => prev.map(r =>
                            r.id === activeRoomId
                              ? { ...r, student: { ...r.student, name: newName } }
                              : r
                          ));
                        }
                      }}
                      language={selectedLang}
                    />
                  ) : activeChannel.type === 'youtube' || activeChannel.type === 'YOUTUBE' ? (
                    <YouTubePlayer language={selectedLang} isCallActive={callActive && callJoined} />
                  ) : (
                    <>
                      <div className="messages" ref={messagesContainerRef}>
                        {messages.length === 0 ? (
                          <div className="empty-state">
                            <div className="empty-state__icon">
                              {activeChannel && <ChannelIcon type={activeChannel.type} iconName={activeChannel.icon} size={40} />}
                            </div>
                            <div className="empty-state__title">
                              {selectedLang === 'en'
                                ? `Welcome to #${getLocalizedChannelName(activeChannel.name, activeChannel.type, selectedLang)}`
                                : `#${activeChannel.name} へようこそ`}
                            </div>
                            <div className="empty-state__desc">
                              {selectedLang === 'en' ? 'Messages will appear here. Try sending your first message.' : 'ここにメッセージが表示されます。最初のメッセージを送ってみましょう。'}
                            </div>
                          </div>
                        ) : (
                          <>
                            {hasMoreMessages && (
                              <button
                                type="button"
                                className="messages__load-older"
                                onClick={handleLoadOlderMessages}
                                disabled={isLoadingOlder}
                              >
                                {isLoadingOlder
                                  ? (selectedLang === 'en' ? 'Loading...' : '読み込み中...')
                                  : (selectedLang === 'en' ? 'Load older messages' : '過去のメッセージを読み込む')}
                              </button>
                            )}
                            {messages.map((msg, i) => {
                            const prevMsg = i > 0 ? messages[i - 1] : null;
                            const currentDateFull = formatDateFull(msg.createdAt);
                            const prevDateFull = prevMsg ? formatDateFull(prevMsg.createdAt) : null;
                            const isDateChanged = currentDateFull !== prevDateFull;
                            const isTimeGap = prevMsg
                              ? new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() >= 60 * 60 * 1000
                              : false;
                            const showAvatar = isDateChanged || isTimeGap || !prevMsg || prevMsg.author.id !== msg.author.id;
                            return (
                              <React.Fragment key={msg.id}>
                                {isDateChanged && (
                                  <div className="date-separator">
                                    <span className="date-separator__line"></span>
                                    <span className="date-separator__label">{currentDateFull}</span>
                                    <span className="date-separator__line"></span>
                                  </div>
                                )}
                                <MessageItem
                                  message={msg}
                                  showAvatar={showAvatar}
                                  onContextMenu={handleMessageContextMenu}
                                  onLongPress={handleMessageLongPress}
                                  isEditing={editingMessageId === msg.id}
                                  editValue={editValue}
                                  onEditChange={setEditValue}
                                  onEditConfirm={handleEditConfirm}
                                  onEditCancel={handleEditCancel}
                                  editInputRef={editInputRef}
                                  onNavigate={handleNavigate}
                                  getChannelName={getChannelName}
                                  origin={typeof window !== 'undefined' ? window.location.origin : ''}
                                  language={selectedLang}
                                  onPdfClick={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
                                  expandedImageId={expandedImageId}
                                  onImageClick={(fileId) => setExpandedImageId(prev => prev === fileId ? null : fileId)}
                                />
                              </React.Fragment>
                            );
                          })}
                          </>
                        )}
                        <div ref={messagesEndRef} />
                      </div>

                      <div className="chat-input">
                        {replyTo && (
                          <div className="chat-input__reply-bar">
                            <span className="chat-input__reply-label">
                              {selectedLang === 'en' ? 'Reply:' : '返信:'} <strong>{replyTo.authorName}</strong>
                            </span>
                            <span className="chat-input__reply-text">
                              {replyTo.content.slice(0, 60)}{replyTo.content.length > 60 ? '...' : ''}
                            </span>
                            <button className="chat-input__reply-close" onClick={() => setReplyTo(null)}>
                              <IconX size={14} />
                            </button>
                          </div>
                        )}
                        {pendingFiles.length > 0 && (
                          <div className="chat-input__attachments">
                            {pendingFiles.map((pf, i) => (
                              <div key={pf.localId} className={`attachment-preview ${pf.error ? 'attachment-preview--error' : ''}`}>
                                {isPreviewableImage(pf.file.type) ? (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={URL.createObjectURL(pf.file)} alt={pf.file.name} className="attachment-preview__thumb" />
                                ) : (
                                  <div className="attachment-preview__icon"><IconFile size={20} /></div>
                                )}
                                <span className="attachment-preview__name">{pf.file.name}</span>
                                <span className={pf.error ? 'attachment-preview__error' : 'attachment-preview__size'}>
                                  {pf.error || formatFileSize(pf.file.size)}
                                </span>
                                {pf.uploading && <div className="attachment-preview__spinner" />}
                                <button className="attachment-preview__remove" onClick={() => removePendingFile(i)} title="削除" disabled={pf.uploading}>
                                  <IconX size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {chatError && (
                          <div className="chat-input__error">{chatError}</div>
                        )}
                        <div className="chat-input__wrapper">
                          <button className="chat-input__btn" title="ファイルを添付" onClick={() => fileInputRef.current?.click()}>
                            <IconPaperclip size={16} />
                          </button>
                          <textarea
                            className="chat-input__field"
                            placeholder={selectedLang === 'en' ? `Message #${getLocalizedChannelName(activeChannel.name, activeChannel.type, selectedLang)}` : `#${activeChannel.name} にメッセージを送信`}
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            rows={1}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage();
                              }
                            }}
                            onPaste={e => {
                              const items = e.clipboardData.items;
                              const pastedFiles: File[] = [];
                              for (let i = 0; i < items.length; i++) {
                                if (items[i].kind === 'file') {
                                  const file = items[i].getAsFile();
                                  if (file) {
                                    // ペーストされたファイルに名前を付与（拡張子が不明な場合は推測）
                                    let ext = file.type.split('/')[1] || 'bin';
                                    if (file.type === 'application/pdf') ext = 'pdf';
                                    const prefix = file.type.startsWith('image/') ? 'pasted-image' : 'pasted-file';
                                    const newFile = new File([file], file.name === 'image.png' ? `${prefix}-${Date.now()}.${ext}` : file.name, { type: file.type });
                                    pastedFiles.push(newFile);
                                  }
                                }
                              }
                              if (pastedFiles.length > 0) {
                                e.preventDefault();
                                handleFileSelect(pastedFiles);
                              } else if (e.clipboardData.files && e.clipboardData.files.length > 0) {
                                e.preventDefault();
                                handleFileSelect(e.clipboardData.files);
                              }
                            }}
                          />
                          <button
                            className="chat-input__btn chat-input__btn--send"
                            title={isSendingMessage ? '送信中' : '送信'}
                            onClick={handleSendMessage}
                            disabled={isSendingMessage}
                          >
                            {isSendingMessage ? <div className="chat-input__spinner" /> : <IconSend size={14} />}
                          </button>
                        </div>
                      </div>

                      {/* コンテキストメニュー */}
                      {contextMenu && (() => {
                        const targetMsg = messages.find(m => m.id === contextMenu.messageId);
                        const firstImage = targetMsg?.files?.find(f => isPreviewableImage(f.mimeType));
                        
                        return (
                          <>
                            {contextMenu.mode === 'sheet' && (
                              <div className="message-action-sheet__backdrop" onClick={() => setContextMenu(null)} />
                            )}
                            <div
                              className={`context-menu ${contextMenu.mode === 'sheet' ? 'context-menu--sheet' : ''}`}
                              style={contextMenu.mode === 'sheet' ? undefined : { top: contextMenu.y, left: contextMenu.x }}
                              onClick={e => e.stopPropagation()}
                            >
                            {contextMenu.mode === 'sheet' && <div className="message-action-sheet__handle" />}
                            {firstImage && (
                              <button className="context-menu__item" onClick={() => {
                                setActiveImageUrl(firstImage.url);
                                setContextMenu(null);
                              }}>
                                <IconPencil size={14} /> {selectedLang === 'en' ? 'Paint' : 'ペイント'}
                              </button>
                            )}
                            {contextMenu.isOwnMessage && (
                              <button className="context-menu__item" onClick={contextActions.edit}>
                                <IconPencil size={14} /> {selectedLang === 'en' ? 'Edit' : '編集'}
                              </button>
                            )}
                            <button className="context-menu__item" onClick={contextActions.copyText}>
                              <IconCopy size={14} /> {selectedLang === 'en' ? 'Copy Text' : 'テキストをコピー'}
                            </button>
                          <button className="context-menu__item" onClick={contextActions.reply}>
                            <IconReply size={14} /> {selectedLang === 'en' ? 'Reply' : '返信'}
                          </button>
                          {authUser?.role === 'TEACHER' && (
                            <button className="context-menu__item" onClick={contextActions.pin}>
                              {contextMenu.isPinned ? <><IconPinOff size={14} /> {selectedLang === 'en' ? 'Unpin' : 'ピン留め解除'}</> : <><IconPin size={14} /> {selectedLang === 'en' ? 'Pin' : 'ピン留め'}</>}
                            </button>
                          )}
                          <button className="context-menu__item" onClick={contextActions.copyLink}>
                            <IconLink size={14} /> {selectedLang === 'en' ? 'Copy Link' : 'メッセージリンクをコピー'}
                          </button>
                          {(contextMenu.isOwnMessage || authUser?.role === 'TEACHER') && (
                            <button className="context-menu__item context-menu__item--danger" onClick={contextActions.delete}>
                              <IconTrash2 size={14} /> {selectedLang === 'en' ? 'Delete' : '削除'}
                            </button>
                          )}
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
                </>
              )}
            </div>

            {/* 2. 通話画面（WebRTC接続維持のため常に1つのインスタンスを使い回す） */}
            <div
              className={callActive && splitView && showCallUI ? 'split-view__call' : ''}
              style={{ display: (callActive && showCallUI) ? 'flex' : 'none', flexDirection: 'column', flex: (callActive && showCallUI && !splitView) ? 1 : undefined, minHeight: 0, minWidth: 0, overflow: 'hidden' }}
              onClick={callActive && splitView && showCallUI ? (e) => {
                // コントロールバー（ボタン類）をクリックした場合はフル画面に戻さない
                if ((e.target as Element).closest('.lesson-controls')) return;
                setSplitView(false);
                setShowCallUI(true);
              } : undefined}
            >
              {callActive && splitView && showCallUI && (
                <div className="split-view__call-overlay">
                  <span className="split-view__expand-hint">
                    <IconVideo size={16} /> {selectedLang === 'en' ? 'Return to Fullscreen' : 'フル画面に戻る'}
                  </span>
                </div>
              )}
              {callActive && (
                <LessonView
                  roomId={callRoomId || ''}
                  roomName={callRoomName}
                  userRole={authUser?.role || 'STUDENT'}
                  userName={userName}
                  compact={splitView}
                  language={selectedLang}
                  onClose={() => {
                    setCallActive(false);
                    setShowCallUI(false);
                    setCallJoined(false);
                    setSplitView(false);
                    setCallRoomId(null);
                    setCallRoomName('');
                  }}
                  onCallJoined={() => {
                    setCallJoined(true);
                    if (callRoomId) {
                      const socket = getSocket();
                      socket.emit('call-invite', { roomId: callRoomId });
                    }
                  }}
                  onUploadToMaterial={async (file) => {
                    if (!callRoomId) return;
                    const room = rooms.find(r => r.id === callRoomId);
                    if (!room) return;
                    // 教材チャンネルを探す (古い形式の SHEET_MUSIC や 楽譜 にもフォールバック対応)
                    const materialChannel = room.channels.find((c: ChannelData) => 
                      c.type === 'MATERIAL' || c.type === 'SHEET_MUSIC' || c.name === '教材' || c.name === '楽譜'
                    );
                    if (!materialChannel) {
                      alert('教材チャンネルが見つかりませんでした。');
                      return;
                    }

                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('channelId', materialChannel.id);
                    try {
                      const res = await fetch('/api/files', { method: 'POST', body: formData });
                      
                      const contentType = res.headers.get('content-type');
                      if (contentType && contentType.includes('application/json')) {
                        const data = await res.json();
                        if (res.ok && data.file) {
                          const socket = getSocket();
                          socket.emit("send_message", {
                            channelId: materialChannel.id,
                            content: "",
                            fileIds: [data.file.id],
                          });
                          alert('スクリーンショットを教材チャンネルに送信しました！');
                        } else {
                          alert(`アップロードに失敗しました: ${data.error || '不明なエラー'}`);
                        }
                      } else {
                        const text = await res.text();
                        console.error('Non-JSON response from server:', text);
                        alert(`アップロード中にサーバーエラーが発生しました (Status: ${res.status})。ファイルサイズが大きすぎる可能性があります。`);
                      }
                    } catch (err) {
                      console.error('Screenshot upload failed:', err);
                      alert('アップロード中にネットワークエラーが発生しました。');
                    }
                  }}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      {/* === 生徒追加モーダル === */}
      {showAddStudent && (
        <div className="modal-overlay" onMouseDown={e => e.currentTarget.dataset.clicked = (e.target === e.currentTarget).toString()} onClick={e => { if (e.target === e.currentTarget && e.currentTarget.dataset.clicked === 'true') setShowAddStudent(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">新しい生徒を追加</div>
            <div className="modal__body">
              <label className="modal__label">
                使用する言語 / Language
                <select
                  className="modal__input"
                  value={newStudent.language}
                  onChange={e => setNewStudent({ ...newStudent, language: e.target.value })}
                >
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                </select>
              </label>

              {newStudent.language === 'ja' ? (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <label className="modal__label" style={{ flex: 1 }}>
                    姓
                    <input
                      className="modal__input"
                      placeholder="例: 山田"
                      value={newStudent.lastName}
                      onChange={e => setNewStudent({ ...newStudent, lastName: e.target.value })}
                    />
                  </label>
                  <label className="modal__label" style={{ flex: 1 }}>
                    名
                    <input
                      className="modal__input"
                      placeholder="例: 太郎"
                      value={newStudent.firstName}
                      onChange={e => setNewStudent({ ...newStudent, firstName: e.target.value })}
                    />
                  </label>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '12px' }}>
                  <label className="modal__label" style={{ flex: 1 }}>
                    First Name
                    <input
                      className="modal__input"
                      placeholder="e.g. John"
                      value={newStudent.firstName}
                      onChange={e => setNewStudent({ ...newStudent, firstName: e.target.value })}
                    />
                  </label>
                  <label className="modal__label" style={{ flex: 1 }}>
                    Last Name
                    <input
                      className="modal__input"
                      placeholder="e.g. Smith"
                      value={newStudent.lastName}
                      onChange={e => setNewStudent({ ...newStudent, lastName: e.target.value })}
                    />
                  </label>
                </div>
              )}
              <label className="modal__label">
                メールアドレス
                <input
                  className="modal__input"
                  type="email"
                  placeholder="例: john@example.com"
                  value={newStudent.email}
                  onChange={e => setNewStudent({ ...newStudent, email: e.target.value })}
                />
              </label>
              <label className="modal__label">
                初期パスワード
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    className="modal__input"
                    type="text"
                    placeholder="生徒に伝えるパスワード"
                    value={newStudent.password}
                    onChange={e => setNewStudent({ ...newStudent, password: e.target.value })}
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setNewStudent({ ...newStudent, password: generateSecurePassword() });
                    }}
                    title="ランダムパスワードを生成"
                    style={{
                      padding: '8px 14px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      color: 'rgba(255,255,255,0.7)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s',
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,106,54,0.15)';
                      e.currentTarget.style.borderColor = 'rgba(255,106,54,0.4)';
                      e.currentTarget.style.color = '#FF6A36';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                    }}
                  >
                    🎲 自動生成
                  </button>
                </div>
              </label>
              {addStudentError && (
                <div className="modal__error">{addStudentError}</div>
              )}
              {studentLoginInfoFallback && (
                <textarea
                  className="modal__input"
                  value={studentLoginInfoFallback}
                  readOnly
                  rows={4}
                  style={{ resize: 'vertical', whiteSpace: 'pre-wrap' }}
                />
              )}
              <div className="modal__hint">
                作成すると、6つのチャンネル付きルームが自動生成されます。
              </div>
            </div>
            <div className="modal__footer">
              <button className="modal__btn modal__btn--cancel" onClick={() => {
                setShowAddStudent(false);
                setStudentLoginInfoFallback('');
              }}>
                キャンセル
              </button>
              <button
                className="modal__btn modal__btn--submit"
                onClick={async () => {
                  if (!studentLoginInfoFallback) {
                    await handleAddStudent();
                    return;
                  }
                  try {
                    await copyText(studentLoginInfoFallback);
                    setStudentLoginInfoFallback('');
                    setAddStudentError('');
                    setShowAddStudent(false);
                    setNewStudent({ firstName: '', lastName: '', email: '', password: '', language: 'ja' });
                  } catch {
                    setAddStudentError('もう一度コピーに失敗しました。表示されているログイン情報を手動でコピーしてください。');
                  }
                }}
              >
                {studentLoginInfoFallback ? 'ログイン情報を再コピー' : '作成してコピー'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === チャンネル追加モーダル === */}
      {showAddChannel && (
        <div className="modal-overlay" onMouseDown={e => e.currentTarget.dataset.clicked = (e.target === e.currentTarget).toString()} onClick={e => { if (e.target === e.currentTarget && e.currentTarget.dataset.clicked === 'true') setShowAddChannel(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">{selectedLang === 'en' ? 'Add text channel' : 'テキストチャンネルを追加'}</div>
            <div className="modal__body">
              <label className="modal__label">
                {selectedLang === 'en' ? 'Channel name' : 'チャンネル名'}
                <input
                  className="modal__input"
                  placeholder={selectedLang === 'en' ? 'Example: Practice notes' : '例: 練習課題'}
                  value={newChannel.name}
                  onChange={e => setNewChannel({ ...newChannel, name: e.target.value })}
                  autoFocus
                />
              </label>

              <div className="modal__hint">
                {selectedLang === 'en'
                  ? 'Special channels such as YouTube are created automatically and cannot be added here.'
                  : 'YouTubeなどの専用チャンネルは自動生成のみです。ここでは通常のテキストチャンネルだけ追加できます。'}
              </div>

              <div className="modal__label">
                {selectedLang === 'en' ? 'Choose an icon' : 'アイコンを選択'}
                <div className="icon-picker">
                  {CURATED_ICONS.map(iconName => (
                    <button
                      key={iconName}
                      className={`icon-picker__item ${newChannel.icon === iconName ? 'active' : ''}`}
                      onClick={() => setNewChannel({ ...newChannel, type: 'CUSTOM', icon: iconName })}
                      title={iconName}
                      type="button"
                    >
                      <ChannelIcon type="CUSTOM" iconName={iconName} size={20} />
                    </button>
                  ))}
                </div>
              </div>

              <label className="modal__toggle">
                <span className="modal__toggle-label">
                  <IconLock size={14} />
                  {selectedLang === 'en' ? 'Teacher only channel' : '先生専用チャンネル'}
                </span>
                <button
                  type="button"
                  className={`modal__switch ${newChannel.teacherOnly ? 'active' : ''}`}
                  onClick={() => setNewChannel({ ...newChannel, teacherOnly: !newChannel.teacherOnly })}
                >
                  <span className="modal__switch-knob" />
                </button>
              </label>

              {newChannel.teacherOnly && (
                <div className="modal__hint">
                  {selectedLang === 'en' ? 'Students cannot see this channel.' : 'このチャンネルは生徒には見えません。'}
                </div>
              )}

              {addChannelError && (
                <div className="modal__error">{addChannelError}</div>
              )}
            </div>
            <div className="modal__footer">
              <button className="modal__btn modal__btn--cancel" onClick={() => setShowAddChannel(false)}>
                キャンセル
              </button>
              <button className="modal__btn modal__btn--submit" onClick={handleAddChannel}>
                追加
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 生徒管理モーダル（先生専用） */}
      {showUserSettings && (
        <div className="modal-overlay" onMouseDown={e => e.currentTarget.dataset.clicked = (e.target === e.currentTarget).toString()} onClick={e => { if (e.target === e.currentTarget && e.currentTarget.dataset.clicked === 'true') setShowUserSettings(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              {selectedLang === 'en' ? 'Student Account Settings' : '生徒のアカウント設定'}
            </div>
            <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* パスワード仮変更 */}
              <div style={{ padding: '16px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '8px', margin: 0, color: 'var(--text-primary)' }}>
                  {selectedLang === 'en' ? 'Temporary Password Reset' : 'パスワードの仮変更'}
                </h4>
                <p style={{ fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '12px', lineHeight: '1.5' }}>
                  {selectedLang === 'en' 
                    ? 'If a student forgets their password, please set a new one and share it with them.' 
                    : '生徒がパスワードを忘れた場合、新しいパスワードを設定して伝えてください。'}
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    className="modal__input"
                    type="text"
                    id="reset-pw-input"
                    placeholder={selectedLang === 'en' ? 'New Password (8+ chars, letters + numbers)' : '新しいパスワード（8文字以上・英字と数字）'}
                    style={{ flex: 1, minWidth: '140px', marginBottom: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.getElementById('reset-pw-input') as HTMLInputElement;
                      if (input) input.value = generateSecurePassword();
                      setPasswordResetNotice('');
                      setPasswordResetFallback('');
                    }}
                    title={selectedLang === 'en' ? 'Generate random password' : 'ランダムパスワードを生成'}
                    style={{
                      padding: '8px 14px',
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      color: 'rgba(255,255,255,0.7)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s',
                      flexShrink: 0,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,106,54,0.15)';
                      e.currentTarget.style.borderColor = 'rgba(255,106,54,0.4)';
                      e.currentTarget.style.color = '#FF6A36';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                    }}
                  >
                    {selectedLang === 'en' ? '🎲 Generate' : '🎲 自動生成'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <button
                    className="modal__btn modal__btn--submit"
                    style={{ padding: '8px 20px', fontSize: 13, margin: 0 }}
                    onClick={async () => {
                      const input = document.getElementById('reset-pw-input') as HTMLInputElement;
                      const password = input?.value.trim() || '';
                      const passwordError = getPasswordStrengthError(password, selectedLang);
                      setPasswordResetNotice('');
                      setPasswordResetFallback('');
                      if (passwordError) {
                        setPasswordResetNotice(passwordError);
                        return;
                      }
                      try {
                        const res = await fetch(`/api/users/${activeRoom?.student.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ newPassword: password }),
                        });
                        if (!res.ok) {
                          const data = await res.json();
                          setPasswordResetNotice(data.error || (selectedLang === 'en' ? 'Failed to update' : '変更に失敗しました'));
                          return;
                        }
                        const loginInfo = buildLoginInfo(selectedLang, activeRoom?.student.email || '', password);
                        try {
                          await copyText(loginInfo);
                          setPasswordResetNotice(selectedLang === 'en'
                            ? 'Password changed and login info copied.'
                            : 'パスワードを変更し、ログイン情報をコピーしました。');
                          if (input) input.value = '';
                        } catch {
                          setPasswordResetFallback(loginInfo);
                          setPasswordResetNotice(selectedLang === 'en'
                            ? 'Password changed, but copying failed. Please copy the login info below.'
                            : 'パスワードは変更されましたが、コピーだけ失敗しました。下のログイン情報をコピーしてください。');
                        }
                      } catch {
                        setPasswordResetNotice(selectedLang === 'en' ? 'Network error occurred' : '通信エラーが発生しました');
                      }
                    }}
                  >
                    {selectedLang === 'en' ? 'Change & Copy' : '変更してコピー'}
                  </button>
                </div>
                {passwordResetNotice && (
                  <div style={{
                    marginTop: 10,
                    fontSize: 12,
                    color: passwordResetFallback
                      ? '#f59e0b'
                      : (passwordResetNotice.includes('コピーしました') || passwordResetNotice.toLowerCase().includes('copied'))
                        ? '#4ade80'
                        : '#ef4444'
                  }}>
                    {passwordResetNotice}
                  </div>
                )}
                {passwordResetFallback && (
                  <textarea
                    className="modal__input"
                    value={passwordResetFallback}
                    readOnly
                    rows={4}
                    style={{ marginTop: 10, resize: 'vertical', whiteSpace: 'pre-wrap' }}
                  />
                )}
              </div>

              {/* 危険な操作 */}
              <div style={{ padding: '16px', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.05)' }}>
                <h4 style={{ color: '#ef4444', fontSize: '0.9rem', marginBottom: '8px', margin: 0 }}>
                  {selectedLang === 'en' ? 'Danger Zone' : '危険な操作'}
                </h4>
                <p style={{ fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '16px', lineHeight: '1.5' }}>
                  {selectedLang === 'en' 
                    ? 'Deleting a student will permanently erase all related messages and lesson records. This action cannot be undone.'
                    : '生徒を退会させると、関連するメッセージやレッスン記録が完全に消去されます。この操作は取り消せません。'}
                </p>
                <button 
                  style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, transition: 'background 0.2s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={async () => {
                    const confirmMsg = selectedLang === 'en'
                      ? `Are you sure you want to delete student "${activeRoom?.student.name}"? This action cannot be undone.`
                      : `本当に生徒「${activeRoom?.student.name}」を退会させますか？この操作は取り消せません。`;
                    if (confirm(confirmMsg)) {
                      try {
                        const res = await fetch(`/api/users/${activeRoom?.student.id}`, { method: 'DELETE' });
                        if (!res.ok) throw new Error('削除失敗');
                        alert(selectedLang === 'en' ? 'Student deleted' : '生徒を削除しました');
                        setShowUserSettings(false);
                        window.location.href = '/'; // リロードして画面をリセット
                      } catch (_e) {
                        alert(selectedLang === 'en' ? 'An error occurred' : 'エラーが発生しました');
                      }
                    }
                  }}
                >
                  {selectedLang === 'en' ? 'Delete Student' : '生徒を退会させる'}
                </button>
              </div>
            </div>
            <div className="modal__footer">
              <button className="modal__btn modal__btn--cancel" onClick={() => setShowUserSettings(false)}>
                {selectedLang === 'en' ? 'Close' : '閉じる'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 設定モーダル */}
      {showSettings && (
        <div className="modal-overlay" onMouseDown={e => e.currentTarget.dataset.clicked = (e.target === e.currentTarget).toString()} onClick={e => { if (e.target === e.currentTarget && e.currentTarget.dataset.clicked === 'true') setShowSettings(false); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <button 
              onClick={() => setShowSettings(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'transparent',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.4)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px'
              }}
            >
              <IconX size={18} />
            </button>
            <div className="modal__header">{selectedLang === 'en' ? 'Account Settings' : 'アカウント設定'}</div>

            <div className="modal__body" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px' }}>
              {/* 名前（先生のみ） */}
              {authUser?.role === 'TEACHER' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    onClick={() => setActiveSettingsTab(activeSettingsTab === 'name' ? null : 'name')}
                    style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                  >
                    <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                      {activeSettingsTab === 'name' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </div>
                    <span>{selectedLang === 'en' ? 'Name' : '名前'}</span>
                  </div>
                  {activeSettingsTab === 'name' && (
                    <div style={{ padding: '0 16px 16px' }}>
                      <input
                        className="modal__input"
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={e => handleProfileSave({ name: e.target.value })}
                        placeholder={selectedLang === 'en' ? "e.g. Demo Teacher" : "例: デモ先生"}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* アイコン設定 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  onClick={() => setActiveSettingsTab(activeSettingsTab === 'avatar' ? null : 'avatar')}
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                >
                  <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                    {activeSettingsTab === 'avatar' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  </div>
                  <span>{selectedLang === 'en' ? 'Profile Icon' : 'プロフィールアイコン'}</span>
                </div>
                {activeSettingsTab === 'avatar' && (
                  <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                      <div style={{ width: 80, height: 80, borderRadius: '50%', background: selectedColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                        <ChannelIcon type={selectedIcon} size={40} />
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>{selectedLang === 'en' ? 'Background Color' : '背景色'}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {AVATAR_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => { setSelectedColor(c); handleProfileSave({ color: c }); }}
                            style={{
                              width: 32, height: 32, borderRadius: '50%', background: c,
                              border: selectedColor === c ? '2px solid #fff' : '2px solid transparent',
                              cursor: 'pointer'
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>{selectedLang === 'en' ? 'Icon' : 'アイコン'}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8, maxHeight: 150, overflowY: 'auto', paddingRight: 8 }} className="custom-scrollbar">
                        {CURATED_ICONS.map(ic => (
                          <button
                            key={ic}
                            onClick={() => { setSelectedIcon(ic); handleProfileSave({ icon: ic }); }}
                            style={{
                              width: 32, height: 32, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: selectedIcon === ic ? 'rgba(255,255,255,0.1)' : 'transparent',
                              color: selectedIcon === ic ? '#fff' : 'rgba(255,255,255,0.6)',
                              border: 'none', cursor: 'pointer'
                            }}
                          >
                            <ChannelIcon type={ic} size={18} />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 言語・タイムゾーン設定 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  onClick={() => setActiveSettingsTab(activeSettingsTab === 'language' ? null : 'language')}
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                >
                  <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                    {activeSettingsTab === 'language' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  </div>
                  <span>言語とタイムゾーン / Language &amp; Timezone</span>
                </div>
                {activeSettingsTab === 'language' && (
                  <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>使用する言語 / Language</div>
                      <select
                        className="modal__input"
                        value={selectedLang}
                        onChange={(e) => { setSelectedLang(e.target.value); handleProfileSave({ lang: e.target.value }); }}
                      >
                        <option value="ja">日本語</option>
                        <option value="en">English</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>タイムゾーン / Timezone</div>
                      <select
                        className="modal__input"
                        value={selectedTimezone}
                        onChange={(e) => { setSelectedTimezone(e.target.value); handleProfileSave({ tz: e.target.value }); }}
                      >
                        {Intl.supportedValuesOf('timeZone').map(tz => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* PWAインストール */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  onClick={() => setActiveSettingsTab(activeSettingsTab === 'pwa' ? null : 'pwa')}
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                >
                  <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                    {activeSettingsTab === 'pwa' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  </div>
                  <span>{selectedLang === 'en' ? 'Install Actlas App' : 'Actlasアプリをインストール'}</span>
                  {isStandaloneApp && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#4ade80' }}>
                      {selectedLang === 'en' ? 'Installed' : 'インストール済み'}
                    </span>
                  )}
                </div>
                {activeSettingsTab === 'pwa' && (
                  <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
                      {isIosDevice
                        ? (selectedLang === 'en'
                          ? 'On iPhone or iPad, add Actlas to the Home Screen before enabling Push notifications.'
                          : 'iPhone / iPadでは、Push通知を有効にする前にActlasをホーム画面へ追加してください。')
                        : (selectedLang === 'en'
                          ? 'On Chrome or Edge, Actlas can open in its own app window from your desktop or taskbar.'
                          : 'PCのChrome / Edgeでは、Actlasをデスクトップやタスクバーから独立したアプリ画面で開けます。')}
                    </div>
                    <button
                      type="button"
                      className="modal__btn modal__btn--submit"
                      style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontSize: 13 }}
                      disabled={isStandaloneApp}
                      onClick={handleInstallApp}
                    >
                      <IconDownload size={14} />
                      {isStandaloneApp
                        ? (selectedLang === 'en' ? 'Installed' : 'インストール済み')
                        : (selectedLang === 'en' ? 'Install' : 'インストール')}
                    </button>
                    <div style={{ fontSize: 12, color: pwaInstallMessage ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
                      {pwaInstallMessage || (isIosDevice
                        ? (selectedLang === 'en'
                          ? 'Open the Share menu and choose Add to Home Screen.'
                          : '共有メニューを開き、「ホーム画面に追加」を選んでください。')
                        : (selectedLang === 'en'
                          ? 'If the button is unavailable, use the install icon on the right side of the browser address bar.'
                          : 'ボタンが使えない場合は、ブラウザのアドレスバー右側にあるインストールアイコンから追加できます。'))}
                    </div>
                  </div>
                )}
              </div>

              {/* メールアドレス変更 */}
              {true && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    onClick={() => {
                      setActiveSettingsTab(activeSettingsTab === 'email' ? null : 'email');
                      setEditEmail(authUser?.email || '');
                      setEmailCurrentPassword('');
                      setEmailChangeCode('');
                      setPendingEmailChange('');
                      setCredentialError('');
                      setCredentialSuccess('');
                    }}
                    style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                  >
                    <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                      {activeSettingsTab === 'email' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </div>
                    <span>{selectedLang === 'en' ? 'Login Email' : 'ログインメールアドレス'}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{authUser?.email}</span>
                  </div>
                  {activeSettingsTab === 'email' && (
                    <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <input
                        className="modal__input"
                        type="email"
                        value={editEmail}
                        onChange={e => setEditEmail(e.target.value)}
                        disabled={!!pendingEmailChange}
                        placeholder={selectedLang === 'en' ? "New Email" : "新しいメールアドレス"}
                      />
                      {!pendingEmailChange ? (
                        <input
                          className="modal__input"
                          type="password"
                          value={emailCurrentPassword}
                          onChange={e => setEmailCurrentPassword(e.target.value)}
                          placeholder={selectedLang === 'en' ? "Current Password" : "現在のパスワード"}
                        />
                      ) : (
                        <>
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                            {selectedLang === 'en'
                              ? `A confirmation code was sent to ${pendingEmailChange}.`
                              : `${pendingEmailChange} に確認コードを送信しました。`}
                          </div>
                          <input
                            className="modal__input"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={emailChangeCode}
                            onChange={e => setEmailChangeCode(e.target.value)}
                            placeholder={selectedLang === 'en' ? "6-digit code" : "6桁の確認コード"}
                          />
                        </>
                      )}
                      {credentialError && activeSettingsTab === 'email' && (
                        <div style={{ fontSize: 12, color: '#ef4444' }}>{credentialError}</div>
                      )}
                      {credentialSuccess && activeSettingsTab === 'email' && (
                        <div style={{ fontSize: 12, color: '#4ade80' }}>{credentialSuccess}</div>
                      )}
                      <button
                        className="modal__btn modal__btn--submit"
                        style={{ alignSelf: 'flex-start', padding: '8px 20px', fontSize: 13 }}
                        onClick={async () => {
                          setCredentialError('');
                          setCredentialSuccess('');
                          try {
                            if (pendingEmailChange) {
                              if (emailChangeCode.trim().length !== 6) {
                                setCredentialError(selectedLang === 'en' ? 'Please enter the 6-digit code' : '6桁の確認コードを入力してください');
                                return;
                              }
                              const res = await fetch('/api/users/profile', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ emailChangeCode: emailChangeCode.trim() }),
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                setCredentialError(data.error || (selectedLang === 'en' ? 'Failed to update' : '変更に失敗しました'));
                                return;
                              }
                              setAuthUser(prev => prev ? { ...prev, email: data.email } : null);
                              setEditEmail(data.email);
                              setEmailCurrentPassword('');
                              setEmailChangeCode('');
                              setPendingEmailChange('');
                              setCredentialSuccess(selectedLang === 'en' ? 'Email updated successfully' : 'メールアドレスを変更しました');
                              return;
                            }

                            if (!editEmail.trim()) {
                              setCredentialError(selectedLang === 'en' ? 'Please enter an email' : 'メールアドレスを入力してください');
                              return;
                            }
                            if (editEmail.trim().toLowerCase() === authUser?.email) {
                              setCredentialError(selectedLang === 'en' ? 'Same as current email' : '現在と同じメールアドレスです');
                              return;
                            }
                            if (!emailCurrentPassword) {
                              setCredentialError(selectedLang === 'en' ? 'Please enter current password' : '現在のパスワードを入力してください');
                              return;
                            }
                            const res = await fetch('/api/users/profile', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ newEmail: editEmail.trim(), currentPassword: emailCurrentPassword }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setCredentialError(data.error || (selectedLang === 'en' ? 'Failed to update' : '変更に失敗しました'));
                              return;
                            }
                            setPendingEmailChange(data.newEmail || editEmail.trim().toLowerCase());
                            setCredentialSuccess(selectedLang === 'en'
                              ? 'Confirmation code sent. Please check the new email address.'
                              : '確認コードを送信しました。新しいメールアドレスを確認してください。');
                          } catch {
                            setCredentialError(selectedLang === 'en' ? 'Network error occurred' : '通信エラーが発生しました');
                          }
                        }}
                      >
                        {pendingEmailChange
                          ? (selectedLang === 'en' ? 'Confirm & Change' : '確認して変更')
                          : (selectedLang === 'en' ? 'Send Code' : '確認コードを送信')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* パスワード変更 */}
              {true && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    onClick={() => {
                      setActiveSettingsTab(activeSettingsTab === 'password' ? null : 'password');
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setCredentialError('');
                      setCredentialSuccess('');
                    }}
                    style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                  >
                    <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                      {activeSettingsTab === 'password' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                    </div>
                    <span>{selectedLang === 'en' ? 'Change Password' : 'パスワード変更'}</span>
                  </div>
                  {activeSettingsTab === 'password' && (
                    <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{selectedLang === 'en' ? 'Current Password' : '現在のパスワード'}</div>
                        <input
                          className="modal__input"
                          type="password"
                          value={currentPassword}
                          onChange={e => setCurrentPassword(e.target.value)}
                          placeholder={selectedLang === 'en' ? "Current Password" : "現在のパスワード"}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{selectedLang === 'en' ? 'New Password' : '新しいパスワード'}</div>
                        <input
                          className="modal__input"
                          type="password"
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          placeholder={selectedLang === 'en' ? "New Password (8+ chars, letters + numbers)" : "新しいパスワード（8文字以上・英字と数字）"}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{selectedLang === 'en' ? 'New Password (Confirm)' : '新しいパスワード（確認）'}</div>
                        <input
                          className="modal__input"
                          type="password"
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          placeholder={selectedLang === 'en' ? "Enter again" : "もう一度入力"}
                        />
                      </div>
                      {credentialError && activeSettingsTab === 'password' && (
                        <div style={{ fontSize: 12, color: '#ef4444' }}>{credentialError}</div>
                      )}
                      {credentialSuccess && activeSettingsTab === 'password' && (
                        <div style={{ fontSize: 12, color: '#4ade80' }}>{credentialSuccess}</div>
                      )}
                      <button
                        className="modal__btn modal__btn--submit"
                        style={{ alignSelf: 'flex-start', padding: '8px 20px', fontSize: 13 }}
                        onClick={async () => {
                          setCredentialError('');
                          setCredentialSuccess('');
                          if (!currentPassword) {
                            setCredentialError(selectedLang === 'en' ? 'Please enter current password' : '現在のパスワードを入力してください');
                            return;
                          }
                          const passwordError = getPasswordStrengthError(newPassword, selectedLang);
                          if (passwordError) {
                            setCredentialError(passwordError);
                            return;
                          }
                          if (newPassword !== confirmPassword) {
                            setCredentialError(selectedLang === 'en' ? 'Passwords do not match' : '新しいパスワードが一致しません');
                            return;
                          }
                          try {
                            const res = await fetch('/api/users/profile', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ currentPassword, newPassword }),
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setCredentialError(data.error || (selectedLang === 'en' ? 'Failed to update' : '変更に失敗しました'));
                              return;
                            }
                            setCurrentPassword('');
                            setNewPassword('');
                            setConfirmPassword('');
                            setCredentialSuccess(selectedLang === 'en' ? 'Password updated successfully' : 'パスワードを変更しました');
                          } catch {
                            setCredentialError(selectedLang === 'en' ? 'Network error occurred' : '通信エラーが発生しました');
                          }
                        }}
                      >
                        {selectedLang === 'en' ? 'Change' : '変更する'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 通知設定 */}
              <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 500 }}>
                  <span>{selectedLang === 'en' ? 'Push Notifications' : 'Push通知'}</span>
                  <button
                    className={`modal__switch ${authUser?.notificationsEnabled ? 'active' : ''}`}
                    disabled={pushBusy}
                    onClick={async () => {
                      const newValue = !authUser?.notificationsEnabled;
                      setPushBusy(true);
                      setPushMessage('');
                      try {
                        const response = await fetch('/api/users/profile', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ notificationsEnabled: newValue }),
                        });
                        if (!response.ok) throw new Error('PUSH_SETTING_SAVE_FAILED');
                        setAuthUser(prev => prev ? { ...prev, notificationsEnabled: newValue } : null);
                      } catch (error) {
                        console.error('Push notification setting update failed:', error);
                        setPushMessage(selectedLang === 'en'
                          ? 'Could not save the Push notification setting.'
                          : 'Push通知の設定を保存できませんでした。');
                      } finally {
                        setPushBusy(false);
                      }
                    }}
                    aria-label={selectedLang === 'en' ? 'Toggle Push notifications' : 'Push通知を切り替え'}
                  >
                    <div className="modal__switch-knob" />
                  </button>
                </div>
                <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.58)', lineHeight: 1.6 }}>
                    {pushSupported
                      ? (pushSubscribed
                        ? (selectedLang === 'en' ? 'This device is registered for smartphone/PC notifications.' : 'この端末はスマホ/PC通知を受け取れる状態です。')
                        : (selectedLang === 'en' ? 'Register this phone or PC to receive notifications even when Actlas is closed.' : 'Actlasを閉じていても受け取れるよう、このスマホ/PCを通知登録できます。'))
                      : (isIosDevice && !isStandaloneApp
                        ? (selectedLang === 'en'
                          ? 'Add Actlas to the Home Screen, then open it from the Home Screen to enable Push notifications.'
                          : 'Actlasをホーム画面に追加し、ホーム画面のActlasから開くとPush通知を有効にできます。')
                        : (selectedLang === 'en' ? 'This browser does not support push notifications.' : 'このブラウザはPush通知に対応していません。'))}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {pushSupported && !pushSubscribed && (
                      <button
                        type="button"
                        className="modal__btn modal__btn--submit"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 13 }}
                        disabled={pushBusy || !authUser?.notificationsEnabled}
                        onClick={handleEnablePushNotifications}
                      >
                        <IconMegaphone size={14} />
                        {selectedLang === 'en' ? 'Enable on this device' : 'この端末で受け取る'}
                      </button>
                    )}
                    {pushSupported && pushSubscribed && (
                      <>
                        <button
                          type="button"
                          className="modal__btn modal__btn--submit"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 13 }}
                          disabled={pushBusy || !authUser?.notificationsEnabled}
                          onClick={handleSendTestPush}
                        >
                          <IconMegaphone size={14} />
                          {selectedLang === 'en' ? 'Send test' : 'テスト送信'}
                        </button>
                        <button
                          type="button"
                          className="modal__btn modal__btn--cancel"
                          style={{ padding: '8px 14px', fontSize: 13 }}
                          disabled={pushBusy}
                          onClick={handleDisablePushNotifications}
                        >
                          {selectedLang === 'en' ? 'Turn off this device' : 'この端末を解除'}
                        </button>
                      </>
                    )}
                  </div>
                  {pushMessage && (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>
                      {pushMessage}
                    </div>
                  )}
                </div>
              </div>

              {/* 退会（危険な操作・生徒のみ） */}
              {viewRole === 'student' && (
                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, overflow: 'hidden' }}>
                <div
                  onClick={() => setActiveSettingsTab(activeSettingsTab === 'danger' ? null : 'danger')}
                  style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
                >
                  <div style={{ color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}>
                    {activeSettingsTab === 'danger' ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                  </div>
                  <span>{selectedLang === 'en' ? 'Delete Account' : 'アカウントの削除（退会）'}</span>
                </div>
                {activeSettingsTab === 'danger' && (
                  <div style={{ padding: '0 16px 16px' }}>
                    <p style={{ fontSize: '0.8rem', color: '#a1a1aa', marginBottom: '16px', lineHeight: '1.5' }}>
                      {selectedLang === 'en' 
                        ? 'Deleting your account will permanently erase all your messages and lesson records. This action cannot be undone.' 
                        : 'アカウントを削除すると、すべてのメッセージやレッスン記録が完全に消去されます。この操作は取り消せません。'}
                    </p>
                    <button 
                      style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, transition: 'background 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={async () => {
                        if (confirm(selectedLang === 'en' ? 'Are you sure you want to delete your account? This action cannot be undone.' : '本当にアカウントを削除しますか？この操作は取り消せません。')) {
                          try {
                            const res = await fetch('/api/users/profile', { method: 'DELETE' });
                            if (!res.ok) throw new Error('削除失敗');
                            window.location.href = '/login';
                          } catch (_e) {
                            alert(selectedLang === 'en' ? 'An error occurred' : 'エラーが発生しました');
                          }
                        }
                      }}
                    >
                      {selectedLang === 'en' ? 'Delete Account' : 'アカウントを削除する'}
                    </button>
                  </div>
                )}
              </div>
              )}

            </div>
            <div className="modal__footer">
              {avatarSaving && <span style={{ fontSize: 13, color: '#a1a1aa', marginRight: 'auto' }}>{selectedLang === 'en' ? 'Saving...' : '保存中...'}</span>}
              <button className="modal__btn modal__btn--cancel" onClick={() => setShowSettings(false)}>{selectedLang === 'en' ? 'Close' : '閉じる'}</button>
            </div>
          </div>
        </div>
      )}
      {/* 通話着信モーダル */}
      {incomingCall && (
        <div className="call-invite-overlay">
          <div className="call-invite-card">
            <div className="call-invite-card__icon">🎥</div>
            <h3 className="call-invite-card__title">
              {formatUserName({ name: incomingCall.callerName, role: incomingCall.callerRole })} から<br />レッスンへ招待されています
            </h3>
            <p className="call-invite-card__desc">
              ビデオ通話に参加しますか？
            </p>
            <div className="call-invite-card__actions">
              <button 
                className="call-invite-card__btn call-invite-card__btn--accept"
                onClick={() => {
                  const room = rooms.find(r => r.id === incomingCall.roomId);
                  setActiveRoomId(incomingCall.roomId);
                  setGlobalView(null);
                  setCallActive(true);
                  setShowCallUI(true);
                  setCallRoomId(incomingCall.roomId);
                  setCallRoomName(
                    viewRole === 'teacher'
                      ? formatUserName({ name: room?.student.name || '', role: 'STUDENT' })
                      : formatUserName({ name: room?.owner?.name || room?.name || 'レッスン', role: 'TEACHER' })
                  );
                  setIncomingCall(null);
                }}
              >
                参加する
              </button>
              <button 
                className="call-invite-card__btn call-invite-card__btn--decline"
                onClick={() => setIncomingCall(null)}
              >
                拒否
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === PDF / 画像プレビューモーダル === */}
      {activePdfUrl && (
        <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.85)' }} onClick={() => setActivePdfUrl(null)}>
          <div style={{ position: 'relative', width: '90%', height: '90%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', paddingBottom: '8px' }}>
              <button
                onClick={() => setActivePdfUrl(null)}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '1rem', padding: '8px' }}
              >
                <IconX size={24} /> {selectedLang === 'en' ? 'Close' : '閉じる'}
              </button>
            </div>
            <iframe src={activePdfUrl} style={{ flex: 1, border: 'none', width: '100%', height: '100%', background: '#fff' }} title="PDF Viewer" />
          </div>
        </div>
      )}
      {activeImageUrl && (
        <AnnotationViewer
          imageUrl={activeImageUrl}
          language={selectedLang}
          onClose={() => setActiveImageUrl(null)}
          sendDrawStroke={sendDrawStroke}
          sendClearCanvas={sendClearCanvas}
          setDrawCallbacks={setDrawCallbacks}
          onSave={async (file) => {
            if (!activeChannelId) return;
            const formData = new FormData();
            formData.append('file', file);
            formData.append('channelId', activeChannelId);
            try {
              const res = await fetch('/api/files', { method: 'POST', body: formData });
              const data = await res.json();
              if (res.ok && data.file) {
                const socket = getSocket();
                socket.emit("send_message", {
                  channelId: activeChannelId,
                  content: selectedLang === 'en' ? "🖌️ Saved annotated image" : "🖌️ ペイント画像を保存しました",
                  fileIds: [data.file.id],
                });
              }
            } catch (err) {
              console.error('Annotated image save failed:', err);
            }
          }}
        />
      )}
    </>
  );
}

function renderMessageContent(
  content: string,
  origin: string,
  onNavigate: (ch: string, msg: string) => void,
  getChannelName: (id: string) => string | undefined
) {
  if (!content) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = content.split(urlRegex);
  
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      try {
        const url = new URL(part);
        if (url.origin === origin && url.searchParams.has('channel') && url.searchParams.has('msg')) {
          const ch = url.searchParams.get('channel')!;
          const m = url.searchParams.get('msg')!;
          const chName = getChannelName(ch);
          return (
            <a key={i} href={part} onClick={(e) => {
              e.preventDefault();
              onNavigate(ch, m);
            }} className="message__link message__link--internal" title={part}>
              {chName ? (
                <span className="message__mention">
                  # {chName} <IconChat size={12} style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 2 }} />
                </span>
              ) : (
                part
              )}
            </a>
          );
        }
      } catch {}
      return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="message__link">{part}</a>;
    }
    return <span key={i}>{part}</span>;
  });
}

/** メッセージ表示 */
function MessageItem({ message, showAvatar, onContextMenu, onLongPress, isEditing, editValue, onEditChange, onEditConfirm, onEditCancel, editInputRef, onNavigate, getChannelName, origin, language, onPdfClick, expandedImageId, onImageClick }: {
  message: SocketMessage;
  showAvatar: boolean;
  onContextMenu: (e: React.MouseEvent, msg: SocketMessage) => void;
  onLongPress: (msg: SocketMessage) => void;
  isEditing: boolean;
  editValue: string;
  onEditChange: (v: string) => void;
  onEditConfirm: () => void;
  onEditCancel: () => void;
  editInputRef: React.RefObject<HTMLTextAreaElement | null>;
  onNavigate: (channelId: string, msgId: string) => void;
  getChannelName: (id: string) => string | undefined;
  origin: string;
  language?: string;
  onPdfClick?: (url: string) => void;
  expandedImageId?: string | null;
  onImageClick?: (fileId: string) => void;
}) {
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateAttempts, setTranslateAttempts] = useState(0);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return;
    longPressTriggeredRef.current = false;
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      onLongPress(message);
      navigator.vibrate?.(10);
    }, 450);
  }, [clearLongPressTimer, message, onLongPress]);

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    clearLongPressTimer();
    if (longPressTriggeredRef.current) {
      e.preventDefault();
      longPressTriggeredRef.current = false;
    }
  }, [clearLongPressTimer]);

  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  useEffect(() => {
    const targetLanguage = language || 'ja';
    const cacheKey = buildTranslationCacheKey(message.id, message.content, targetLanguage);
    const legacyCacheKey = `actlas_trans_${message.id}_${targetLanguage}`;
    localStorage.removeItem(legacyCacheKey);
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(`actlas_trans_v2_${message.id}_${targetLanguage}_`) && key !== cacheKey) {
        localStorage.removeItem(key);
      }
    }
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      // localStorageからのキャッシュ読み込み（マウント時のみ）
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTranslatedText(cached);
    } else {
      setTranslatedText(null);
    }
  }, [message.id, message.content, language]);

  const handleTranslate = async () => {
    if (PUBLIC_DEMO) {
      alert(AI_DISABLED_MESSAGE);
      return;
    }
    // 翻訳成功済みの場合は何もしない（再翻訳によるAPI消費防止）
    if (!message.content || isTranslating || translatedText) return;
    
    // イタズラ防止：最大3回まで
    if (translateAttempts >= 3) {
      alert(language === 'en' ? 'Translation retry limit (3 times) reached.' : '翻訳の再試行回数の上限（3回）に達しました。');
      return;
    }

    setIsTranslating(true);
    setTranslateAttempts(prev => prev + 1);

    try {
      const res = await fetch('/api/translate-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message.content,
          targetLanguage: language || 'ja'
        }),
      });

      if (!res.ok) throw new Error('翻訳失敗');
      const data = await res.json();
      setTranslatedText(data.translated);
      localStorage.setItem(buildTranslationCacheKey(message.id, message.content, language || 'ja'), data.translated);
    } catch (err) {
      console.error('翻訳エラー:', err);
      alert(language === 'en' ? 'Translation failed. Please try again.' : '翻訳に失敗しました。もう一度お試しください。');
    } finally {
      setIsTranslating(false);
    }
  };

  const isSystem = message.isSystem;
  if (isSystem) {
    const localizedContent = localizeReservationSystemMessage(message.content, language);
    return (
      <div className="message" style={{ marginTop: '12px' }}>
        <div className="message__avatar"
          style={{ background: 'linear-gradient(135deg, #FF6A36, #FF6A36)' }}>
          <IconBot size={18} />
        </div>
        <div className="message__body">
          <div className="message__header">
            <span className="message__author" style={{ color: '#FF6A36' }}>Actlas Bot</span>
            <span className="message__time">{formatDate(message.createdAt)} {formatTime(message.createdAt)}</span>
          </div>
          <div className="message__content message__content--system">{localizedContent}</div>
        </div>
      </div>
    );
  }

  const files = message.files || [];

  return (
    <div
      id={`msg-${message.id}`}
      className={`message ${message.isPinned ? 'message--pinned' : ''} ${!showAvatar ? 'message--compact' : ''}`}
      style={{ marginTop: showAvatar ? '12px' : '0' }}
      onContextMenu={e => onContextMenu(e, message)}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {showAvatar ? (
        <div style={{ width: 48, flexShrink: 0 }}>
          <UserAvatar user={message.author} size={36} />
        </div>
      ) : (
        <div className="message__timestamp-compact" style={{ width: 48, flexShrink: 0, textAlign: 'right' }}>
          {formatTime(message.createdAt)}
        </div>
      )}
      <div className="message__body">
        {showAvatar && (
          <div className="message__header">
            <span className="message__author">
              {formatUserName(message.author as { name: string; role: string })}
            </span>
            <span className="message__time">{formatDate(message.createdAt)} {formatTime(message.createdAt)}</span>
            {message.isPinned && (
              <span className="message__pin-badge">
                <IconPin size={10} style={{ marginRight: 2, display: 'inline-block', transform: 'rotate(45deg)' }} />
                {language === 'en' ? 'Pinned' : 'ピン留め'}
              </span>
            )}
            {message.isEdited && <span className="message__edited">{language === 'en' ? '(Edited)' : '(編集済み)'}</span>}
          </div>
        )}
        {/* 返信元表示 */}
        {message.replyTo && (
          <div className="message__reply-ref">
            <span className="message__reply-ref-author">{message.replyTo.author.name}</span>
            <span className="message__reply-ref-text">{localizeReservationSystemMessagePreview(message.replyTo.content, language).slice(0, 80)}</span>
          </div>
        )}
        {/* 編集モード or 通常表示 */}
        {isEditing ? (
          <div className="message__edit-box">
            <textarea
              ref={editInputRef}
              className="message__edit-input"
              value={editValue}
              onChange={e => onEditChange(e.target.value)}
              rows={2}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onEditConfirm();
                }
                if (e.key === 'Escape') onEditCancel();
              }}
            />
            <div className="message__edit-actions">
              <button className="message__edit-btn" onClick={onEditCancel}>{language === 'en' ? 'Cancel' : 'キャンセル'}</button>
              <button className="message__edit-btn message__edit-btn--save" onClick={onEditConfirm}>{language === 'en' ? 'Save' : '保存'}</button>
            </div>
          </div>
        ) : (
          message.content && (
            <div className="message__content-wrapper" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <div className="message__content">{renderMessageContent(message.content, origin, onNavigate, getChannelName)}</div>
              
              {/* 翻訳結果表示 */}
              {translatedText && (
                <div className="message__translated-content" style={{ marginTop: '8px', padding: '8px 12px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px', fontSize: '0.9rem', color: 'var(--text-primary)', borderLeft: '3px solid #3b82f6' }}>
                  <div style={{ fontSize: '0.7rem', color: '#3b82f6', marginBottom: '4px', fontWeight: 'bold' }}>{language === 'en' ? 'A/A Translation' : 'A/あ 翻訳結果'}</div>
                  {translatedText}
                </div>
              )}
              
              {/* 翻訳ボタン（翻訳済みの場合は非表示にする） */}
              {!translatedText && (
                <button 
                  onClick={handleTranslate} 
                  className="message__translate-btn"
                  style={{ 
                    marginTop: '4px', 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'var(--text-muted)', 
                    fontSize: '0.75rem', 
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    transition: 'background 0.2s, color 0.2s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  disabled={PUBLIC_DEMO || isTranslating}
                  title={PUBLIC_DEMO ? AI_DISABLED_MESSAGE : (language === 'en' ? 'Translate message' : 'メッセージを翻訳')}
                >
                  <IconGlobe size={12} />
                  {isTranslating ? (language === 'en' ? 'Translating...' : '翻訳中...') : (language === 'en' ? 'Translate' : '翻訳')}
                </button>
              )}
            </div>
          )
        )}
        {/* 添付ファイル表示 */}
        {files.length > 0 && (
          <div className="message__files">
            {files.map(f => (
              isPreviewableImage(f.mimeType) ? (
                <a key={f.id} href={f.url} onClick={(e) => { e.preventDefault(); if (onImageClick) onImageClick(f.id); }} className={`message__image-wrap ${expandedImageId === f.id ? 'message__image-wrap--expanded' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt={f.filename} className={`message__image ${expandedImageId === f.id ? 'message__image--expanded' : ''}`} loading="lazy" />
                </a>
              ) : (
                <a 
                  key={f.id} 
                  href={f.mimeType === 'application/pdf' && onPdfClick ? '#' : f.url} 
                  target={f.mimeType === 'application/pdf' && onPdfClick ? undefined : "_blank"} 
                  rel="noopener noreferrer" 
                  className="message__file"
                  onClick={(e) => {
                    if (f.mimeType === 'application/pdf' && onPdfClick) {
                      e.preventDefault();
                      onPdfClick(f.url);
                    }
                  }}
                >
                  <div className="message__file-icon-wrap">
                    <IconFile size={32} />
                  </div>
                  <div className="message__file-info">
                    <span className="message__file-name">{f.filename}</span>
                    <span className="message__file-size">{formatFileSize(f.size)}</span>
                  </div>
                </a>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
