'use client';

/**
 * LessonView — Actlas内蔵の通話画面コンポーネント
 * 
 * GuitarCallの通話機能をActlasに統合したもの。
 * WebRTCビデオ通話 + リアルタイム翻訳字幕 + レッスン記録AI要約
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket, type CallAudioMode, type JoinCallResponse } from '@/lib/socket';
import { WebRTCManager, ConnectionState } from '@/lib/webrtc';
import {
  createSharedAudioContext,
  createAudioAnalyser,
  createRemoteAudioPlayer,
  enumerateAudioDevices,
  getMicOnlyConstraints,
  getVoiceOnlyConstraints,
  getGuitarLineConstraints,
  createDualAudioStream,
  AudioInputDevice,
} from '@/lib/audio';
import { TranslationManager, TranslationState } from '@/lib/translate';
import { AI_DISABLED_MESSAGE, PUBLIC_DEMO } from '@/lib/public-demo';
import { MultiCameraComposer } from '@/lib/multicam';
import { Mic, MicOff, Video, VideoOff, Camera, Focus, Settings, Phone, User, RefreshCcw, MonitorSmartphone, Timer, Play, Pause } from 'lucide-react';

/** 翻訳先の言語オプション */
const LANGUAGES = [
  { code: 'en', label: '🇺🇸 English' },
  { code: 'es', label: '🇪🇸 Spanish' },
  { code: 'fr', label: '🇫🇷 French' },
  { code: 'de', label: '🇩🇪 German' },
  { code: 'pt', label: '🇧🇷 Portuguese' },
  { code: 'zh', label: '🇨🇳 Chinese' },
  { code: 'ko', label: '🇰🇷 Korean' },
  { code: 'it', label: '🇮🇹 Italian' },
  { code: 'ru', label: '🇷🇺 Russian' },
  { code: 'ar', label: '🇸🇦 Arabic' },
  { code: 'hi', label: '🇮🇳 Hindi' },
  { code: 'nl', label: '🇳🇱 Dutch' },
  { code: 'ja', label: '🇯🇵 Japanese' },
];

const CLICK_BPM_MIN = 40;
const CLICK_BPM_MAX = 300;
const DUAL_VOICE_DEFAULT_VOLUME = 150;

type BrowserAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const clampClickBpm = (value: number) => {
  if (!Number.isFinite(value)) return 80;
  return Math.min(CLICK_BPM_MAX, Math.max(CLICK_BPM_MIN, Math.round(value)));
};

interface LessonViewProps {
  roomId: string;
  roomName: string;
  userRole: 'TEACHER' | 'STUDENT';
  /** ログインユーザーの表示名（コントロールバーの音声レベルに表示） */
  userName: string;
  onClose: () => void;
  /** 分割画面時のコンパクト表示モード */
  compact?: boolean;
  /** 「通話を開始する」ボタンが押されたときのコールバック */
  onCallJoined?: () => void;
  /** キャプチャした画像を教材チャンネルにアップロードするコールバック */
  onUploadToMaterial?: (file: File) => void;
  language?: string;
}

type HangUpOptions = {
  askCompletion?: boolean;
};

export default function LessonView({ roomId, roomName, userRole, userName, onClose, compact = false, onCallJoined, onUploadToMaterial, language = 'ja' }: LessonViewProps) {
  const isTeacher = userRole === 'TEACHER';
  const appMode = process.env.NEXT_PUBLIC_APP_MODE || 'guitar';

  // 通話の状態
  const [hasJoined, setHasJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [error, setError] = useState('');
  const [audioDeviceError, setAudioDeviceError] = useState('');
  const [cameraDeviceError, setCameraDeviceError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [remoteVolume, setRemoteVolume] = useState(100);
  const [remoteGuitarVolume, setRemoteGuitarVolume] = useState(50);
  const [guitarVolume, setGuitarVolume] = useState(20);
  const [voiceVolume, setVoiceVolume] = useState(DUAL_VOICE_DEFAULT_VOLUME);
  const [clickBpm, setClickBpm] = useState(80);
  const [isClickPlaying, setIsClickPlaying] = useState(false);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);

  // 音量ポップアップの表示状態
  const [showVolumePopup, setShowVolumePopup] = useState(false);
  const [showClickPopup, setShowClickPopup] = useState(false);
  const volumePopupRef = useRef<HTMLDivElement | null>(null);

  // 翻訳の状態
  const [translationState, setTranslationState] = useState<TranslationState>('idle');
  const [subtitle, setSubtitle] = useState('');
  const [translationError, setTranslationError] = useState('');
  // 手動で選択された翻訳先言語（null時はlanguage propから自動決定）
  const [manualTargetLanguage, setManualTargetLanguage] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('actlas_target_language');
  });
  // 翻訳先言語: 手動選択があれば優先、なければlanguage propから決定（set-state-in-effect回避）
  const targetLanguage = manualTargetLanguage ?? (language === 'en' ? 'en' : 'ja');
  const [translationEnabled, setTranslationEnabled] = useState(!PUBLIC_DEMO);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // デュアルオーディオ入力の状態
  // 'mic-only': 従来通りマイク1本（ギターもマイクで拾う）
  // 'dual': マイク（声専用）＋ オーディオI/F（ギター直入力）
  type AudioInputMode = CallAudioMode;
  const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('mic-only');
  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([]);
  const [selectedVoiceDevice, setSelectedVoiceDevice] = useState('');
  const [selectedGuitarDevice, setSelectedGuitarDevice] = useState('');
  const [devicesLoading, setDevicesLoading] = useState(false);

  // マルチカメラの状態
  const [multiCameraEnabled, setMultiCameraEnabled] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [mainCameraId, setMainCameraId] = useState('');  // 手元用（メイン）
  const [subCameraId, setSubCameraId] = useState('');    // 顔用（サブ・左下小窓）
  const [camerasLoading, setCamerasLoading] = useState(false);
  const [multiCamActive, setMultiCamActive] = useState(false); // 通話中にマルチカメラが有効か
  const [showCameraPopup, setShowCameraPopup] = useState(false); // 通話中のカメラ選択ポップアップ
  const [showSettingsPopup, setShowSettingsPopup] = useState(false); // 通話中の設定ポップアップ
  const [showScreenshotPopup, setShowScreenshotPopup] = useState(false); // スクショ対象選択ポップアップ
  const [peerLeftPromptVisible, setPeerLeftPromptVisible] = useState(false);
  const [showCompletionPrompt, setShowCompletionPrompt] = useState(false);
  const [completionSaving, setCompletionSaving] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const composerRef = useRef<MultiCameraComposer | null>(null);
  const cameraPopupRef = useRef<HTMLDivElement | null>(null);
  const settingsPopupRef = useRef<HTMLDivElement | null>(null);
  const screenshotPopupRef = useRef<HTMLDivElement | null>(null);
  const clickPopupRef = useRef<HTMLDivElement | null>(null);

  // PWA判定用ステート（初期値を関数で計算してset-state-in-effectを回避）
  const [isStandalone] = useState(() => {
    if (typeof window === 'undefined') return true; // SSRではtrue（チラつき防止）
    return window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true);
  });

  // レンダー中のrefアクセス回避用ステート（React Compiler準拠）
  const [hasGuitarTrack, setHasGuitarTrack] = useState(false); // 相手音声にギタートラックがあるか
  const [currentVideoDeviceId, setCurrentVideoDeviceId] = useState<string | undefined>(undefined); // 現在使用中のメインカメラdeviceId

  // Ref
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const sharedContextRef = useRef<AudioContext | null>(null);
  const remoteAudioPlayerRef = useRef<ReturnType<typeof createRemoteAudioPlayer> | null>(null);
  const audioInputModeRef = useRef<AudioInputMode>(audioInputMode);
  const peerAudioInputModeRef = useRef<AudioInputMode>('mic-only');
  const remotePlaybackHasGuitarRef = useRef<boolean | null>(null);
  const remotePlaybackStreamRef = useRef<MediaStream | null>(null);
  const remoteVolumeRef = useRef(remoteVolume);
  const remoteGuitarVolumeRef = useRef(remoteGuitarVolume);
  const translationRef = useRef<TranslationManager | null>(null);
  const isMountedRef = useRef(true);
  const voiceGainRef = useRef<GainNode | null>(null);
  const guitarGainRef = useRef<GainNode | null>(null);
  const targetLanguageRef = useRef(language === 'en' ? 'en' : 'ja');
  const translationEnabledRef = useRef(!PUBLIC_DEMO);
  const peerTranslationEnabledRef = useRef(!PUBLIC_DEMO);
  const peerTargetLanguageRef = useRef<string | null>(null);
  const subtitleLogsRef = useRef<{ text: string; speaker: string; time: string }[]>([]);
  const localGetLevelRef = useRef<(() => number) | null>(null);
  const remoteGetLevelRef = useRef<(() => number) | null>(null);
  // 音声アナライザーのdisconnect関数（ストリーム参照を解放するため）
  const localAnalyserDisconnectRef = useRef<(() => void) | null>(null);
  const remoteAnalyserDisconnectRef = useRef<(() => void) | null>(null);
  // デュアル入力時の合成ストリームdisconnect関数
  const mergedStreamDisconnectRef = useRef<(() => void) | null>(null);
  // デュアル入力時に声専用ストリームを保持（翻訳APIにはこれだけ渡す）
  const voiceOnlyStreamRef = useRef<MediaStream | null>(null);
  // デュアル入力時のギターストリーム（クリーンアップ用）
  const guitarStreamRef = useRef<MediaStream | null>(null);
  const activeVoiceDeviceIdRef = useRef('');
  const activeGuitarDeviceIdRef = useRef('');
  const clickAudioContextRef = useRef<AudioContext | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const clickBpmRef = useRef(clickBpm);
  const endingCallRef = useRef(false);
  // joinCallで取得した生のカメラストリーム（hangUp時に確実に解放するため保持）
  const rawVideoStreamRef = useRef<MediaStream | null>(null);
  // Socket イベントリスナーの参照を保持するRef（各ハンドラーの型を明示的に定義）
  const socketListenersRef = useRef<Record<string, (...args: unknown[]) => void>>({});

  // targetLanguageRefを最新のtargetLanguageと同期（ref更新はset-state-in-effect対象外）
  useEffect(() => {
    targetLanguageRef.current = targetLanguage;
  }, [targetLanguage]);

  useEffect(() => {
    clickBpmRef.current = clickBpm;
  }, [clickBpm]);

  useEffect(() => {
    audioInputModeRef.current = audioInputMode;
  }, [audioInputMode]);

  useEffect(() => {
    remoteVolumeRef.current = remoteVolume;
  }, [remoteVolume]);

  useEffect(() => {
    remoteGuitarVolumeRef.current = remoteGuitarVolume;
  }, [remoteGuitarVolume]);

  const stopClickPlayback = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setIsClickPlaying(false);
  }, []);

  const playLocalClick = useCallback((accent: boolean) => {
    if (typeof window === 'undefined') return;
    const audioWindow = window as BrowserAudioWindow;
    const AudioContextConstructor = audioWindow.AudioContext || audioWindow.webkitAudioContext;
    if (!AudioContextConstructor) return;

    const context = clickAudioContextRef.current ?? new AudioContextConstructor();
    clickAudioContextRef.current = context;
    if (context.state === 'suspended') void context.resume();

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(accent ? 1400 : 980, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.28 : 0.2, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.07);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }, []);

  const startClickPlayback = useCallback(() => {
    playLocalClick(true);
    setIsClickPlaying(true);
  }, [playLocalClick]);

  useEffect(() => {
    if (!isClickPlaying) {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      return;
    }

    let stopped = false;
    let beat = 1;
    const scheduleNextClick = () => {
      if (stopped) return;
      playLocalClick(beat % 4 === 0);
      beat += 1;
      clickTimerRef.current = window.setTimeout(scheduleNextClick, 60000 / clickBpmRef.current);
    };

    clickTimerRef.current = window.setTimeout(scheduleNextClick, 60000 / clickBpmRef.current);

    return () => {
      stopped = true;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
    };
  }, [isClickPlaying, playLocalClick]);

  const sendTranslationPreference = useCallback((enabled: boolean = translationEnabledRef.current) => {
    const socket = getSocket();
    socket.emit('target-language', {
      language: targetLanguageRef.current,
      enabled: PUBLIC_DEMO ? false : enabled,
    });
  }, []);

  const sendCallAudioMode = useCallback((mode: AudioInputMode = audioInputModeRef.current) => {
    getSocket().emit('call-audio-mode', { mode });
  }, []);

  const requestCallAccessCheck = (
    socket: ReturnType<typeof getSocket>,
    targetRoomId: string,
  ): Promise<JoinCallResponse> => {
    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        resolve({
          ok: false,
          code: 'join-timeout',
          message: language === 'en'
            ? 'Could not confirm this call before using your camera and microphone. Please check your connection and try again.'
            : 'カメラとマイクを使う前の通話確認ができませんでした。通信状況を確認して、もう一度お試しください。',
        });
      }, 10000);

      socket.emit('check-call-access', targetRoomId, (response) => {
        window.clearTimeout(timeoutId);
        resolve(response);
      });
    });
  };

  const requestJoinCall = (
    socket: ReturnType<typeof getSocket>,
    targetRoomId: string,
  ): Promise<JoinCallResponse> => {
    return new Promise((resolve) => {
      const timeoutId = window.setTimeout(() => {
        resolve({
          ok: false,
          code: 'join-timeout',
          message: language === 'en'
            ? 'Could not join the call. Please check your connection and try again.'
            : '通話への参加確認ができませんでした。通信状況を確認して、もう一度お試しください。',
        });
      }, 10000);

      socket.emit('join-call', targetRoomId, (response) => {
        window.clearTimeout(timeoutId);
        resolve(response);
      });
    });
  };

  const getJoinFailureMessage = (response: JoinCallResponse): string => {
    if (response.code === 'room-full') {
      return language === 'en'
        ? 'This lesson call is already open in two places. Close the other tab and try again.'
        : 'このレッスン通話はすでに2人で使用中です。別のタブや端末の通話を閉じてから、もう一度お試しください。';
    }
    if (response.code === 'forbidden') {
      return language === 'en'
        ? 'You do not have permission to join this lesson call.'
        : 'このレッスン通話に参加する権限がありません。';
    }
    return response.message || (language === 'en'
      ? 'Could not join the call. Please try again.'
      : '通話に参加できませんでした。もう一度お試しください。');
  };

  const getMediaDeviceFailureMessage = (err: unknown): string => {
    if (err instanceof DOMException) {
      if (err.name === 'NotAllowedError') {
        return language === 'en'
          ? 'Please allow access to your camera and microphone.'
          : 'カメラとマイクへのアクセスを許可してください。';
      }
      if (err.name === 'NotFoundError') {
        return language === 'en'
          ? 'A camera or microphone was not found.'
          : 'カメラまたはマイクが見つかりません。';
      }
      if (err.name === 'OverconstrainedError') {
        return language === 'en'
          ? 'The selected audio input does not support the requested lesson settings. Choose another device or start with Microphone Only.'
          : '選択した音声入力がレッスン用の設定に対応していません。別の入力を選ぶか、「マイクのみ」で開始してください。';
      }
      if (err.name === 'NotReadableError') {
        return language === 'en'
          ? 'The selected device is already in use by another app. Close the other app or choose another device.'
          : '選択したデバイスが別のアプリで使用中です。他のアプリを閉じるか、別のデバイスを選んでください。';
      }
    }

    return err instanceof Error ? err.message : `初期化エラー: ${err}`;
  };

  // クリーンアップとマウント状態の管理
  useEffect(() => {
    console.log('[LessonView] MOUNTED');
    isMountedRef.current = true; // StrictModeでの再マウント時にtrueに戻す
    // クリーンアップ時にref値が変わらないよう、マウント時の参照を保存
    const localVideo = localVideoRef.current;
    const remoteVideo = remoteVideoRef.current;

    return () => {
      console.log('[LessonView] UNMOUNTED! Trace:', new Error().stack);
      isMountedRef.current = false;
      // video要素のsrcObjectを解放（ブラウザのカメラ参照を切る）
      if (localVideo) localVideo.srcObject = null;
      if (remoteVideo) remoteVideo.srcObject = null;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      voiceOnlyStreamRef.current?.getTracks().forEach(t => t.stop());
      guitarStreamRef.current?.getTracks().forEach(t => t.stop());
      rawVideoStreamRef.current?.getTracks().forEach(t => t.stop());
      remoteStreamRef.current?.getTracks().forEach(t => t.stop());
      
      localAnalyserDisconnectRef.current?.();
      remoteAnalyserDisconnectRef.current?.();
      mergedStreamDisconnectRef.current?.();
      remoteAudioPlayerRef.current?.stop();
      remoteAudioPlayerRef.current = null;
      remotePlaybackHasGuitarRef.current = null;
      remotePlaybackStreamRef.current = null;
      remoteGetLevelRef.current = null;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      clickAudioContextRef.current?.close().catch(() => {});
      clickAudioContextRef.current = null;

      sharedContextRef.current?.close().catch(() => {});
      webrtcRef.current?.close();
      translationRef.current?.stop();
      // マルチカメラComposerの破棄
      const currentComposer = composerRef.current as MultiCameraComposer | null;
      currentComposer?.destroy();
      composerRef.current = null;
      
      const socket = getSocket();
      socket.emit('leave-call');

      // 自分が登録した特定のリスナーだけを解除
      Object.entries(socketListenersRef.current).forEach(([event, handler]) => {
        socket.off(event as never, handler as never);
      });
      socketListenersRef.current = {};
    };
  }, []);

  // 通話時間タイマーと音声レベル監視ループ
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (connectionState === 'connected') {
      timer = setInterval(() => setCallDuration(d => d + 1), 1000);
    }
    
    // 音声レベル監視ループ（1フレームごとに更新）
    let animationFrameId: number;
    const updateLevels = () => {
      try {
        if (localGetLevelRef.current) setLocalAudioLevel(localGetLevelRef.current());
        if (remoteGetLevelRef.current) setRemoteAudioLevel(remoteGetLevelRef.current());
      } catch (e) {
        console.warn('[LessonView] 音声レベル取得エラー:', e);
      }
      animationFrameId = requestAnimationFrame(updateLevels);
    };
    updateLevels();

    return () => {
      if (timer) clearInterval(timer);
      cancelAnimationFrame(animationFrameId);
    };
  }, [connectionState]);

  // 音量ポップアップの外側クリックで閉じる処理
  useEffect(() => {
    if (!showVolumePopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (volumePopupRef.current && !volumePopupRef.current.contains(e.target as Node)) {
        setShowVolumePopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showVolumePopup]);

  // カメラポップアップの外側クリックで閉じる処理
  useEffect(() => {
    if (!showCameraPopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cameraPopupRef.current && !cameraPopupRef.current.contains(e.target as Node)) {
        setShowCameraPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCameraPopup]);

  // 設定ポップアップの外側クリックで閉じる処理
  useEffect(() => {
    if (!showSettingsPopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsPopupRef.current && !settingsPopupRef.current.contains(e.target as Node)) {
        setShowSettingsPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsPopup]);

  // スクショポップアップの外側クリックで閉じる処理
  useEffect(() => {
    if (!showScreenshotPopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (screenshotPopupRef.current && !screenshotPopupRef.current.contains(e.target as Node)) {
        setShowScreenshotPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showScreenshotPopup]);

  // クリック音ポップアップの外側クリックで閉じる処理
  useEffect(() => {
    if (!showClickPopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (clickPopupRef.current && !clickPopupRef.current.contains(e.target as Node)) {
        setShowClickPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showClickPopup]);

  // スクリーンショット撮影関数
  const takeScreenshot = (target: 'remote' | 'local') => {
    setShowScreenshotPopup(false);
    const videoElement = target === 'remote' ? remoteVideoRef.current : localVideoRef.current;
    if (!videoElement) {
      console.warn('対象のビデオ要素が見つかりません');
      return;
    }
    if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
      console.warn('映像がまだロードされていないか、無効な解像度です');
      alert(language === 'en' ? 'Failed to take screenshot: Video is not ready.' : 'スクリーンショットの撮影に失敗しました：映像の準備ができていません');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // video要素の現在フレームをcanvasに描画
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (blob && onUploadToMaterial) {
          const targetName = target === 'remote' ? (language === 'en' ? 'peer' : '相手') : (language === 'en' ? 'self' : '自分');
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
          // ファイルサイズ肥大化（Next.jsのボディサイズ制限）を防ぐためJPEGで保存
          const file = new File([blob], `screenshot_${targetName}_${timestamp}.jpg`, { type: 'image/jpeg' });
          onUploadToMaterial(file);
        }
      }, 'image/jpeg', 0.8);
    } catch (e) {
      console.error('Screenshot failed:', e);
    }
  };

  const getMainVideoConstraints = (deviceId: string, quality: 'high' | 'fallback'): MediaTrackConstraints => {
    const constraints: MediaTrackConstraints = quality === 'high'
      ? {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30 },
        }
      : {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 30 },
        };

    if (deviceId) {
      constraints.deviceId = { exact: deviceId };
    } else {
      constraints.facingMode = 'user';
    }

    return constraints;
  };

  const getVideoStreamForDevice = async (deviceId: string): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getMainVideoConstraints(deviceId, 'high'),
      });
    } catch (e) {
      console.warn('高画質でのカメラ取得に失敗。フォールバックします', e);
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: getMainVideoConstraints(deviceId, 'fallback'),
      });
    }
  };

  const prepareFixedVideoOutput = async (
    mainStream: MediaStream,
    mainDeviceId: string,
    nextSubCameraId?: string,
  ): Promise<{ track: MediaStreamTrack; multiActive: boolean }> => {
    let composer = composerRef.current;
    if (!composer) {
      composer = new MultiCameraComposer();
      composerRef.current = composer;
    }

    const resolvedMainDeviceId = mainDeviceId || mainStream.getVideoTracks()[0]?.getSettings().deviceId || 'default';
    await composer.setMainCamera(mainStream, resolvedMainDeviceId);
    await composer.removeSubCamera();

    let nextMultiActive = false;
    if (nextSubCameraId && nextSubCameraId !== resolvedMainDeviceId) {
      try {
        await composer.addCamera(nextSubCameraId);
        nextMultiActive = composer.isMultiCameraActive();
      } catch (e) {
        console.warn('[MultiCam] サブカメラの追加に失敗。メインカメラのみで続行します:', e);
      }
    }

    const composedStream = composer.startComposing();
    const composedTrack = composedStream.getVideoTracks()[0];
    if (!composedTrack) {
      throw new Error('合成映像トラックを取得できませんでした。');
    }
    composedTrack.enabled = !isCameraOff;

    return { track: composedTrack, multiActive: nextMultiActive };
  };

  const applyOutgoingVideoTrack = async (
    newTrack: MediaStreamTrack,
    options: { warnOnly?: boolean } = {},
  ) => {
    if (!localStreamRef.current) return;

    const currentVideoTracks = localStreamRef.current.getVideoTracks();
    const alreadyUsingTrack = currentVideoTracks.length === 1 && currentVideoTracks[0].id === newTrack.id;

    if (!alreadyUsingTrack) {
      if (webrtcRef.current) {
        try {
          await webrtcRef.current.replaceVideoTrack(newTrack);
        } catch (e) {
          if (!options.warnOnly) throw e;
          console.warn('[MultiCam] WebRTCトラックの差し替えをスキップしました（まだ接続されていません）', e);
        }
      }

      currentVideoTracks.forEach(t => {
        localStreamRef.current?.removeTrack(t);
        if (t.id !== newTrack.id) t.stop();
      });
      localStreamRef.current.addTrack(newTrack);
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  };

  const resetLocalAudioAnalyser = (stream: MediaStream) => {
    const sharedContext = sharedContextRef.current ?? undefined;

    try {
      localAnalyserDisconnectRef.current?.();
    } catch (e) {
      console.warn('[LessonView] 古い音声メーターの切断をスキップしました:', e);
    }

    localGetLevelRef.current = null;
    localAnalyserDisconnectRef.current = null;
    setLocalAudioLevel(0);

    const localAnalyser = createAudioAnalyser(stream, sharedContext);
    localGetLevelRef.current = localAnalyser.getLevel;
    localAnalyserDisconnectRef.current = localAnalyser.disconnect;
  };

  const attachRemoteVideoElement = useCallback((stream: MediaStream) => {
    const video = remoteVideoRef.current;
    if (!video) return;

    const playbackStream = new MediaStream(stream.getVideoTracks());
    const currentStream = video.srcObject as MediaStream | null;
    const nextTracks = playbackStream.getTracks();
    const currentTracks = currentStream?.getTracks() || [];
    const isSame =
      currentStream &&
      nextTracks.length === currentTracks.length &&
      nextTracks.every((track, index) => track.id === currentTracks[index]?.id);

    if (!isSame) {
      video.srcObject = playbackStream;
    }

    video.muted = true;
    video.volume = 0;
    video.play().catch(() => {});
  }, []);

  const configureRemotePlayback = useCallback((stream: MediaStream, peerHasGuitarTrack: boolean) => {
    attachRemoteVideoElement(stream);

    const alreadyConfigured =
      remotePlaybackStreamRef.current === stream &&
      remotePlaybackHasGuitarRef.current === peerHasGuitarTrack &&
      Boolean(remoteAudioPlayerRef.current);

    if (alreadyConfigured) {
      remoteAudioPlayerRef.current?.setVolume(remoteVolumeRef.current);
      remoteAudioPlayerRef.current?.setGuitarVolume(remoteGuitarVolumeRef.current);
      setHasGuitarTrack(peerHasGuitarTrack);
      return;
    }

    remoteAnalyserDisconnectRef.current?.();
    remoteAnalyserDisconnectRef.current = null;
    remoteGetLevelRef.current = null;
    remoteAudioPlayerRef.current?.stop();
    remoteAudioPlayerRef.current = null;
    remotePlaybackStreamRef.current = null;

    const sharedContext = sharedContextRef.current ?? undefined;
    const remoteAudioPlayer = createRemoteAudioPlayer(stream, true, sharedContext, peerHasGuitarTrack);
    remoteAudioPlayer.setVolume(remoteVolumeRef.current);
    remoteAudioPlayer.setGuitarVolume(remoteGuitarVolumeRef.current);
    remoteAudioPlayerRef.current = remoteAudioPlayer;

    const remoteAnalyser = createAudioAnalyser(stream, remoteAudioPlayer.context);
    remoteGetLevelRef.current = remoteAnalyser.getLevel;
    remoteAnalyserDisconnectRef.current = remoteAnalyser.disconnect;

    remotePlaybackHasGuitarRef.current = peerHasGuitarTrack;
    remotePlaybackStreamRef.current = stream;
    setHasGuitarTrack(peerHasGuitarTrack);
  }, [attachRemoteVideoElement]);

  const setLocalAudioTracksEnabled = useCallback((enabled: boolean) => {
    const updatedTrackIds = new Set<string>();
    const updateStream = (stream: MediaStream | null) => {
      stream?.getAudioTracks().forEach(track => {
        if (updatedTrackIds.has(track.id)) return;
        track.enabled = enabled;
        updatedTrackIds.add(track.id);
      });
    };

    updateStream(localStreamRef.current);
    updateStream(voiceOnlyStreamRef.current);
    updateStream(guitarStreamRef.current);
  }, []);

  const syncLocalAudioMuteState = useCallback((muted: boolean = isMuted) => {
    setLocalAudioTracksEnabled(!muted);
  }, [isMuted, setLocalAudioTracksEnabled]);

  const applyLocalDualGainLevels = useCallback((
    voiceGain: GainNode | null = voiceGainRef.current,
    guitarGain: GainNode | null = guitarGainRef.current,
    context: AudioContext | null = sharedContextRef.current,
  ) => {
    if (!context) return;
    voiceGain?.gain.setValueAtTime(voiceVolume / 100, context.currentTime);
    guitarGain?.gain.setValueAtTime(guitarVolume / 100, context.currentTime);
  }, [guitarVolume, voiceVolume]);

  const isLiveAudioStream = (stream: MediaStream | null) => (
    Boolean(stream?.getAudioTracks().some(track => track.readyState === 'live'))
  );

  // 通話中デバイス設定の適用
  const applyDeviceSettings = async () => {
    let pendingVideoStream: MediaStream | null = null;
    let pendingVoiceStream: MediaStream | null = null;
    let pendingGuitarStream: MediaStream | null = null;
    let pendingDualDisconnect: (() => void) | null = null;
    try {
      if (!webrtcRef.current || !localStreamRef.current) return;
      if (audioInputMode === 'dual') {
        if (!selectedVoiceDevice || !selectedGuitarDevice) {
          setError(language === 'en' ? 'Please select both a voice microphone and guitar input.' : '声用マイクとギター入力を両方選択してください。');
          return;
        }
        if (selectedVoiceDevice === selectedGuitarDevice) {
          setError(language === 'en' ? 'Please choose different devices for voice and guitar.' : '声用マイクとギター入力には別々のデバイスを選んでください。');
          return;
        }
      }
      setError('');
      
      // 映像の更新
      const previousRawVideoStream = rawVideoStreamRef.current;
      pendingVideoStream = await getVideoStreamForDevice(mainCameraId);
      const activeMainDeviceId = mainCameraId || pendingVideoStream.getVideoTracks()[0]?.getSettings().deviceId || 'default';
      const { track: composedTrack, multiActive: nextMultiActive } = await prepareFixedVideoOutput(
        pendingVideoStream,
        activeMainDeviceId,
        multiCamActive ? subCameraId : undefined,
      );
      await applyOutgoingVideoTrack(composedTrack);
      
      // メモリリーク対策：新しく取得したカメラストリームを確実に保持する
      previousRawVideoStream?.getTracks().forEach(t => t.stop());
      rawVideoStreamRef.current = pendingVideoStream;
      pendingVideoStream = null;
      setCurrentVideoDeviceId(activeMainDeviceId === 'default' ? undefined : activeMainDeviceId);
      setMultiCamActive(nextMultiActive);

      // 音声の更新
      if (audioInputMode === 'mic-only') {
        pendingVoiceStream = await navigator.mediaDevices.getUserMedia(
          getMicOnlyConstraints(selectedVoiceDevice, appMode === 'standard')
        );
        const newVoiceStream = pendingVoiceStream;
        const newTrack = newVoiceStream.getAudioTracks()[0];
        await webrtcRef.current.replaceAudioTrack(newTrack);

        const previousVoiceStream = voiceOnlyStreamRef.current;
        localStreamRef.current.getAudioTracks().forEach(t => { localStreamRef.current?.removeTrack(t); t.stop(); });
        localStreamRef.current.addTrack(newTrack);
        voiceOnlyStreamRef.current = newVoiceStream;
        activeVoiceDeviceIdRef.current = selectedVoiceDevice || newTrack.getSettings().deviceId || '';
        activeGuitarDeviceIdRef.current = '';
        pendingVoiceStream = null;
        resetLocalAudioAnalyser(newVoiceStream);
        syncLocalAudioMuteState();
        previousVoiceStream?.getTracks().forEach(t => {
          if (t.id !== newTrack.id) t.stop();
        });
        sendCallAudioMode('mic-only');

        // デバイス変更後に翻訳を再起動（翻訳機能が有効な場合）
        if (translationEnabledRef.current) {
          if (translationRef.current) {
            translationRef.current.stop();
          }
          autoStartTranslation();
        }
      } else if (audioInputMode === 'dual') {
        // マイクのみで開始した場合など、AudioContextが未作成の場合はここで作成
        if (!sharedContextRef.current) {
          const sharedContext = await createSharedAudioContext();
          sharedContextRef.current = sharedContext;
        }

        const previousVoiceStream = voiceOnlyStreamRef.current;
        const previousGuitarStream = guitarStreamRef.current;
        const previousMergedDisconnect = mergedStreamDisconnectRef.current;
        const reusableGuitarStream =
          activeGuitarDeviceIdRef.current === selectedGuitarDevice && isLiveAudioStream(previousGuitarStream)
            ? previousGuitarStream
            : null;

        const voiceStream = await navigator.mediaDevices.getUserMedia(getVoiceOnlyConstraints(selectedVoiceDevice));
        pendingVoiceStream = voiceStream;
        const guitarStream = reusableGuitarStream ?? await navigator.mediaDevices.getUserMedia(getGuitarLineConstraints(selectedGuitarDevice));
        if (!reusableGuitarStream) pendingGuitarStream = guitarStream;

        const { voiceOnlyStream, guitarEffectStream, voiceGain, guitarGain, disconnect: dualDisconnect } = createDualAudioStream(voiceStream, guitarStream, sharedContextRef.current);
        pendingDualDisconnect = dualDisconnect;

        applyLocalDualGainLevels(voiceGain, guitarGain, sharedContextRef.current);

        const newAudioTrack = guitarEffectStream.getAudioTracks()[0] || voiceOnlyStream.getAudioTracks()[0];
        if (!newAudioTrack) {
          throw new Error(language === 'en' ? 'Could not prepare the new microphone audio.' : '新しいマイク音声を準備できませんでした。');
        }

        await webrtcRef.current.replaceAudioTrack(newAudioTrack);

        localStreamRef.current.getAudioTracks().forEach(t => { localStreamRef.current?.removeTrack(t); t.stop(); });
        localStreamRef.current.addTrack(newAudioTrack);

        try {
          previousMergedDisconnect?.();
        } catch (disconnectError) {
          console.warn('[LessonView] 古いデュアル音声ノードの切断をスキップしました:', disconnectError);
        }
        pendingDualDisconnect = null;
        mergedStreamDisconnectRef.current = dualDisconnect;
        voiceGainRef.current = voiceGain;
        guitarGainRef.current = guitarGain;
        voiceOnlyStreamRef.current = voiceStream;
        guitarStreamRef.current = guitarStream;
        activeVoiceDeviceIdRef.current = selectedVoiceDevice;
        activeGuitarDeviceIdRef.current = selectedGuitarDevice;

        try {
          resetLocalAudioAnalyser(voiceStream);
        } catch (analyserError) {
          console.warn('[LessonView] 新しいマイクの音量メーター再作成に失敗しました:', analyserError);
        }
        syncLocalAudioMuteState();
        pendingVoiceStream = null;
        pendingGuitarStream = null;
        const streamsToKeep = new Set([voiceStream, guitarStream]);
        if (previousVoiceStream && !streamsToKeep.has(previousVoiceStream)) {
          previousVoiceStream.getTracks().forEach(t => t.stop());
        }
        if (previousGuitarStream && !streamsToKeep.has(previousGuitarStream)) {
          previousGuitarStream.getTracks().forEach(t => t.stop());
        }

        sendCallAudioMode('dual');

        // デバイス変更後に翻訳を再起動（翻訳機能が有効な場合）
        if (translationEnabledRef.current) {
          if (translationRef.current) {
            translationRef.current.stop();
          }
          autoStartTranslation();
        }
      }

      setShowSettingsPopup(false);
    } catch (e) {
      pendingDualDisconnect?.();
      pendingVideoStream?.getTracks().forEach(t => t.stop());
      pendingVoiceStream?.getTracks().forEach(t => t.stop());
      pendingGuitarStream?.getTracks().forEach(t => t.stop());
      console.error(e);
      setError(getMediaDeviceFailureMessage(e));
    }
  };

  // カメラデバイス一覧の取得
  const loadCameraDevices = useCallback(async () => {
    setCamerasLoading(true);
    setCameraDeviceError('');
    try {
      // カメラのラベルを取得するために一時的に許可を取得
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      tempStream.getTracks().forEach(t => t.stop());
      const cameras = await MultiCameraComposer.getAvailableCameras();
      setAvailableCameras(cameras);
      if (cameras.length === 0) {
        setCameraDeviceError(language === 'en' ? 'No camera was found.' : 'カメラが見つかりません。');
      }
      // デフォルト選択（1台目を顔用、それ以外があれば手元用に）
      if (cameras.length >= 1 && !mainCameraId) setMainCameraId(cameras[0].deviceId);
      if (cameras.length >= 2 && !subCameraId) setSubCameraId(cameras.length >= 2 ? cameras[1].deviceId : '');
    } catch (err) {
      console.error('カメラ列挙エラー:', err);
      setAvailableCameras([]);
      setCameraDeviceError(language === 'en'
        ? 'Camera access was denied or no camera is available. Please check your browser settings.'
        : 'カメラへのアクセスが拒否されたか、使用できるカメラがありません。ブラウザの設定を確認してください。');
    }
    setCamerasLoading(false);
  }, [language, mainCameraId, subCameraId]);


  // 翻訳自動開始
  const autoStartTranslation = useCallback(async () => {
    if (PUBLIC_DEMO) {
      setTranslationState('idle');
      setTranslationError(AI_DISABLED_MESSAGE);
      return;
    }
    if (!peerTranslationEnabledRef.current) return;
    
    // デュアル入力時は声専用ストリームを翻訳に渡す（ギター音が混入すると誤認識の原因）
    const streamForTranslation = voiceOnlyStreamRef.current || localStreamRef.current;
    if (!streamForTranslation) return;

    const lang = peerTargetLanguageRef.current || targetLanguageRef.current;

    const manager = new TranslationManager({
      onSubtitle: (text) => {
        if (!isMountedRef.current) return;
        if (!peerTranslationEnabledRef.current) return;
        const socket = getSocket();
        socket.emit('translated-subtitle', { text, final: false });
      },
      onTranscriptDone: (text) => {
        if (!isMountedRef.current) return;
        if (!peerTranslationEnabledRef.current) return;
        if (text.trim()) {
          const socket = getSocket();
          socket.emit('translated-subtitle', { text: text.trim(), final: true });
          subtitleLogsRef.current.push({
            text: text.trim(),
            speaker: isTeacher ? 'teacher' : 'student',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          });
        }
      },
      onStateChange: (state) => {
        if (!isMountedRef.current) return;
        setTranslationState(state);
        if (state === 'connecting' || state === 'active' || state === 'reconnecting') {
          setTranslationError('');
        }
      },
      onError: (err) => {
        if (!isMountedRef.current) return;
        console.error('翻訳エラー:', err);
        setTranslationError(err);
      },
    });
    
    // もし古いインスタンスがあれば停止する（重複起動防止）
    if (translationRef.current) {
      translationRef.current.stop();
    }
    translationRef.current = manager;

    try {
      setTranslationError('');
      await manager.start(streamForTranslation, lang, roomId);
    } catch (e) {
      console.warn('翻訳開始が中断されました:', e);
      if (isMountedRef.current) {
        setTranslationError(e instanceof Error ? e.message : '翻訳の開始に失敗しました');
      }
    }
  }, [isTeacher, roomId]);

  // ビデオ要素へのストリーム割り当てを確実に行う
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
    }
  }, [localStream, hasJoined]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      const peerHasGuitarTrack = appMode === 'guitar' && peerAudioInputModeRef.current === 'dual';
      configureRemotePlayback(remoteStream, peerHasGuitarTrack);
    }
  }, [appMode, configureRemotePlayback, remoteStream]);

   /** 通話に参加 */
  const joinCall = async () => {
    console.log('[WebRTC] 🎬 joinCallが呼ばれました');
    
    // 既存のリソースがある場合は安全にクリーンアップする（連続クリック・再接続対策）
    if (webrtcRef.current) {
      webrtcRef.current.close();
      webrtcRef.current = null;
    }
    translationRef.current?.stop();
    translationRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    voiceOnlyStreamRef.current?.getTracks().forEach(t => t.stop());
    guitarStreamRef.current?.getTracks().forEach(t => t.stop());
    rawVideoStreamRef.current?.getTracks().forEach(t => t.stop());
    remoteStreamRef.current?.getTracks().forEach(t => t.stop());
    localAnalyserDisconnectRef.current?.();
    remoteAnalyserDisconnectRef.current?.();
    remoteAnalyserDisconnectRef.current = null;
    remoteGetLevelRef.current = null;
    guitarGainRef.current?.disconnect();
    voiceGainRef.current?.disconnect();
    mergedStreamDisconnectRef.current?.();
    
    remoteAudioPlayerRef.current?.stop();
    remoteAudioPlayerRef.current = null;
    remotePlaybackHasGuitarRef.current = null;
    remotePlaybackStreamRef.current = null;

    composerRef.current?.destroy();
    composerRef.current = null;

    // 緊急クリーンアップ用のローカル参照
    let activeVideoStream: MediaStream | null = null;
    let activeVoiceStream: MediaStream | null = null;
    let activeGuitarStream: MediaStream | null = null;

    try {
      const socket = getSocket();
      const accessCheck = await requestCallAccessCheck(socket, roomId);
      if (!accessCheck.ok) {
        throw new Error(getJoinFailureMessage(accessCheck));
      }

      const usesDualAudio = audioInputMode === 'dual' && Boolean(selectedVoiceDevice && selectedGuitarDevice);
      let localStream: MediaStream;

      // ===== 映像の取得（マルチカメラ対応） =====
      console.log('[WebRTC] 📷 カメラの取得を開始します...');
      const videoStream = await getVideoStreamForDevice(mainCameraId);
      console.log('[WebRTC] ✅ カメラ取得成功');
      activeVideoStream = videoStream;
      rawVideoStreamRef.current = videoStream;
      // 現在使用中のカメラdeviceIdをstateに保存（レンダー中のrefアクセス回避）
      const activeMainDeviceId = mainCameraId || videoStream.getVideoTracks()[0]?.getSettings().deviceId || 'default';
      setCurrentVideoDeviceId(activeMainDeviceId === 'default' ? undefined : activeMainDeviceId);

      // デバイス取得中にすでに画面が閉じられていた場合の安全対策
      if (!isMountedRef.current) {
        videoStream.getTracks().forEach(t => t.stop());
        return;
      }

      // ===== 固定Canvas出力（単体カメラ時も同じ土台で送信） =====
      const shouldUseSubCamera = multiCameraEnabled && subCameraId && activeMainDeviceId !== subCameraId;
      const { track: fixedVideoTrack, multiActive: initialMultiActive } = await prepareFixedVideoOutput(
        videoStream,
        activeMainDeviceId,
        shouldUseSubCamera ? subCameraId : undefined,
      );
      const finalVideoStream = new MediaStream([fixedVideoTrack]);
      setMultiCamActive(initialMultiActive);

      // ===== 音声の取得（モードで分岐） =====
      if (usesDualAudio) {
        // --- デュアルモード: 声用マイク＋ギターライン入力 ---
        console.log('[WebRTC] 🎤+🎸 デュアルオーディオモードで取得中...');

        // 声用マイク（ノイズキャンセルON）
        const voiceStream = await navigator.mediaDevices.getUserMedia(
          getVoiceOnlyConstraints(selectedVoiceDevice)
        );
        activeVoiceStream = voiceStream;
        voiceOnlyStreamRef.current = voiceStream;
        activeVoiceDeviceIdRef.current = selectedVoiceDevice;
        console.log('[WebRTC] ✅ 声用マイク取得成功');

        if (!isMountedRef.current) {
          videoStream.getTracks().forEach(t => t.stop());
          voiceStream.getTracks().forEach(t => t.stop());
          return;
        }

        // ギターライン入力（ノイズキャンセルOFF）
        const guitarStream = await navigator.mediaDevices.getUserMedia(
          getGuitarLineConstraints(selectedGuitarDevice)
        );
        activeGuitarStream = guitarStream;
        guitarStreamRef.current = guitarStream;
        activeGuitarDeviceIdRef.current = selectedGuitarDevice;
        console.log('[WebRTC] ✅ ギターライン入力取得成功');

        if (!isMountedRef.current) {
          videoStream.getTracks().forEach(t => t.stop());
          voiceStream.getTracks().forEach(t => t.stop());
          guitarStream.getTracks().forEach(t => t.stop());
          return;
        }

        // AudioContextを先に作成（ストリーム合成に必要）
        const sharedContext = await createSharedAudioContext();
        sharedContextRef.current = sharedContext;

        // 2つの音声ストリームを合成
        const { voiceOnlyStream, guitarEffectStream, voiceGain, guitarGain, disconnect: dualDisconnect } = createDualAudioStream(voiceStream, guitarStream, sharedContext);
        mergedStreamDisconnectRef.current = dualDisconnect;
        voiceGainRef.current = voiceGain;
        guitarGainRef.current = guitarGain;
        applyLocalDualGainLevels(voiceGain, guitarGain, sharedContext);
        console.log('[WebRTC] ✅ 音声ストリーム合成成功');

        // 映像＋合成音声で最終ストリームを構築（マルチカメラ合成映像 or 通常映像）
        // 映像＋合成音声で最終ストリームを構築
        const audioTracks = audioInputMode === 'dual' 
          ? [guitarEffectStream.getAudioTracks()[0]] // ギターとマイクが合成されたL/Rステレオストリーム
          : [voiceOnlyStream.getAudioTracks()[0]];   // マイクのみのストリーム
        
        localStream = new MediaStream([
          ...finalVideoStream.getVideoTracks(),
          ...audioTracks,
        ]);

        // 音声レベルメーター（合成後のストリームを監視）
        const localAnalyser = createAudioAnalyser(voiceOnlyStream, sharedContext);
        localGetLevelRef.current = localAnalyser.getLevel;
        localAnalyserDisconnectRef.current = localAnalyser.disconnect;
        console.log('[WebRTC] ✅ デュアルモード初期化完了');

      } else {
        // --- 従来モード: マイクのみ（ギターもマイクで拾う） ---
        console.log('[WebRTC] 🎤 マイクのみモードで取得中...');
        const voiceDeviceId = selectedVoiceDevice || audioDevices[0]?.deviceId;
        const audioStream = await navigator.mediaDevices.getUserMedia(
          getMicOnlyConstraints(voiceDeviceId, appMode === 'standard')
        );
        activeVoiceStream = audioStream;
        voiceOnlyStreamRef.current = audioStream; // 映像と合成する前のピュアな音声ストリームを翻訳用に保持
        activeVoiceDeviceIdRef.current = voiceDeviceId || audioStream.getAudioTracks()[0]?.getSettings().deviceId || '';
        activeGuitarDeviceIdRef.current = '';
        console.log('[WebRTC] ✅ マイク取得成功');

        if (!isMountedRef.current) {
          videoStream.getTracks().forEach(t => t.stop());
          audioStream.getTracks().forEach(t => t.stop());
          return;
        }

        // 映像＋音声で最終ストリームを構築（マルチカメラ合成映像 or 通常映像）
        localStream = new MediaStream([
          ...finalVideoStream.getVideoTracks(),
          ...audioStream.getAudioTracks(),
        ]);

        // 音声レベルメーター（マイク単一では送信音声に共有AudioContextを挟まない）
        const sharedContext = await createSharedAudioContext();
        sharedContextRef.current = sharedContext;
        const localAnalyser = createAudioAnalyser(audioStream, sharedContext);
        localGetLevelRef.current = localAnalyser.getLevel;
        localAnalyserDisconnectRef.current = localAnalyser.disconnect;
        console.log('[WebRTC] ✅ マイクのみモード初期化完了');
      }

      localStreamRef.current = localStream;
      syncLocalAudioMuteState();
      setLocalStream(localStream);
      if (!isMountedRef.current) return;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        console.log('[WebRTC] 📺 ローカルビデオにストリームをセットしました');
      }

      // WebRTCマネージャー作成
      console.log('[WebRTC] 🌐 WebRTCManagerを作成します...');
      const webrtc = new WebRTCManager({
        onStateChange: (state) => {
          if (isMountedRef.current) {
            setConnectionState(state);
            if (state === 'connected') setCallDuration(0);
          }
        },
        onRemoteStream: (stream) => {
          if (!isMountedRef.current) return;
          remoteStreamRef.current = stream;
          setRemoteStream(stream);

          const setupRemotePlayback = () => {
            if (stream.getAudioTracks().length === 0) return;
            const peerHasGuitarTrack = appMode === 'guitar' && peerAudioInputModeRef.current === 'dual';
            configureRemotePlayback(stream, peerHasGuitarTrack);
          };
          setupRemotePlayback();
          stream.onaddtrack = (e) => { if (e.track.kind === 'audio') setupRemotePlayback(); };

          // 言語設定を送信し翻訳開始
          sendTranslationPreference();
          setTimeout(() => autoStartTranslation(), 1000);
        },
        onIceCandidate: (c) => {
          const s = getSocket();
          s.emit('ice-candidate', c.toJSON());
        },
        onError: (err) => { if (isMountedRef.current) setError(err); },
      });
      webrtcRef.current = webrtc;

      // ハンドラの定義
      const handleOffer = async (offer: RTCSessionDescriptionInit) => {
        console.log('[WebRTC] 📥 Offerを受信:', offer);

        // Glare（Offer衝突）対策: Polite/Impolite パターン
        const isOfferCollision = webrtc.getState() === 'waiting';
        if (isOfferCollision) {
          if (!isTeacher) {
            // 生徒（Polite）は自分のOfferを取り下げて、相手（先生）のOfferを優先する
            console.log('[WebRTC] 💥 Offer衝突: 生徒側として相手のOfferを優先します');
            webrtc.close(); // いったん閉じて新しいAnswerを作るためにリセット
          } else {
            // 先生（Impolite）は相手のOfferを無視して、自分のOfferに対するAnswerを待つ
            console.log('[WebRTC] 💥 Offer衝突: 先生側のため相手のOfferを無視します');
            return;
          }
        }

        try {
          if (webrtc.getState() === 'connected' || webrtc.getState() === 'connecting') {
            // 通話中の再ネゴシエーション
            const answer = await webrtc.renegotiateAnswer(offer);
            console.log('[WebRTC] 📤 再ネゴシエーションのAnswerを送信:', answer);
            socket.emit('answer', answer);
          } else {
            // 新しい通話セッションのため古いコネクションがあればリセット
            webrtc.close();
            if (remoteAudioPlayerRef.current) {
              remoteAudioPlayerRef.current.stop();
              remoteAudioPlayerRef.current = null;
            }
            remoteAnalyserDisconnectRef.current?.();
            remoteAnalyserDisconnectRef.current = null;
            remoteGetLevelRef.current = null;
            remotePlaybackHasGuitarRef.current = null;
            remotePlaybackStreamRef.current = null;
            const answer = await webrtc.createAnswer(localStream, offer);
            console.log('[WebRTC] 📤 Answerを送信:', answer);
            socket.emit('answer', answer);
          }
        } catch (e) { 
          console.error('[WebRTC] Offer処理エラー:', e);
          if (isMountedRef.current) setError(`接続エラー: ${e}`); 
        }
      };

      const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
        console.log('[WebRTC] 📥 Answerを受信:', answer);
        try { await webrtc.handleAnswer(answer); }
        catch (e) { 
          console.error('[WebRTC] Answer処理エラー:', e);
          if (isMountedRef.current) setError(`接続エラー: ${e}`); 
        }
      };

      const handleIceCandidate = async (c: RTCIceCandidateInit) => {
        console.log('[WebRTC] 📥 ICE Candidateを受信');
        try { await webrtc.addIceCandidate(c); } catch { /* ICE失敗は無視 */ }
      };

      const handlePeerJoined = async () => {
        console.log('[WebRTC] 👥 相手がルームに参加しました。Offerを作成します...');
        if (!isMountedRef.current) return;
        setPeerLeftPromptVisible(false);
        sendCallAudioMode();

        // 相手が再接続してきた場合、古いコネクションを破棄して完全に作り直す
        webrtc.close();
        if (remoteAudioPlayerRef.current) {
          remoteAudioPlayerRef.current.stop();
          remoteAudioPlayerRef.current = null;
        }
        remoteAnalyserDisconnectRef.current?.();
        remoteAnalyserDisconnectRef.current = null;
        remoteGetLevelRef.current = null;
        remotePlaybackHasGuitarRef.current = null;
        remotePlaybackStreamRef.current = null;
        try {
          const offer = await webrtc.createOffer(localStream);
          console.log('[WebRTC] 📤 Offerを送信:', offer);
          socket.emit('offer', offer);
        } catch (e) { 
          console.error('[WebRTC] Offer作成エラー:', e);
          if (isMountedRef.current) setError(`接続エラー: ${e}`); 
        }
      };

      const handlePeerLeft = () => {
        console.log('[WebRTC] 🚪 相手が退出しました');
        if (!isMountedRef.current) return;
        // 相手が退出したらコネクションと音声を完全に破棄
        webrtc.close();
        if (remoteAudioPlayerRef.current) {
          remoteAudioPlayerRef.current.stop();
          remoteAudioPlayerRef.current = null;
        }
        remoteAnalyserDisconnectRef.current?.();
        remoteAnalyserDisconnectRef.current = null;
        remoteGetLevelRef.current = null;
        remotePlaybackHasGuitarRef.current = null;
        remotePlaybackStreamRef.current = null;
        remoteStreamRef.current = null;
        peerAudioInputModeRef.current = 'mic-only';
        setHasGuitarTrack(false);
        setRemoteStream(null);
        setConnectionState('waiting');
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
        translationRef.current?.stop();
        setSubtitle('');
        setTranslationState('idle');
        setTranslationError('');
        if (isTeacher) {
          setPeerLeftPromptVisible(true);
        }
      };

      const handleRoomFull = () => {
        setError(language === 'en'
          ? 'This lesson call is already open in two places. Close the other tab and try again.'
          : 'このレッスン通話はすでに2人で使用中です。別のタブや端末の通話を閉じてから、もう一度お試しください。');
      };

      const handleCallReplaced = (data: { message: string }) => {
        setError(data.message);
        hangUp({ askCompletion: false });
      };

      const handleTranslatedSubtitle = (data: { text: string; final?: boolean }) => {
        if (!isMountedRef.current) return;
        if (!translationEnabledRef.current) {
          setSubtitle('');
          return;
        }
        setSubtitle(data.text);
        if (data.final && data.text.trim()) {
          subtitleLogsRef.current.push({
            text: data.text.trim(),
            speaker: isTeacher ? 'student' : 'teacher',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          });
        }
      };

      const handleCallAudioMode = (data: { mode: CallAudioMode }) => {
        if (!isMountedRef.current) return;
        peerAudioInputModeRef.current = data.mode;
        const peerHasGuitarTrack = appMode === 'guitar' && data.mode === 'dual';
        if (remoteStreamRef.current) {
          configureRemotePlayback(remoteStreamRef.current, peerHasGuitarTrack);
        }
        setHasGuitarTrack(peerHasGuitarTrack);
      };

      const handleTargetLanguage = (data: { language: string; enabled?: boolean }) => {
        peerTargetLanguageRef.current = data.language;
        peerTranslationEnabledRef.current = PUBLIC_DEMO ? false : (data.enabled ?? true);

        if (!peerTranslationEnabledRef.current) {
          translationRef.current?.stop();
          translationRef.current = null;
          setTranslationState('idle');
          setTranslationError(PUBLIC_DEMO ? AI_DISABLED_MESSAGE : '');
          return;
        }

        const currentTranslation = translationRef.current;
        const currentState = currentTranslation?.getState();
        if (currentTranslation && (currentState === 'active' || currentState === 'connecting' || currentState === 'reconnecting')) {
          currentTranslation.stop();
          autoStartTranslation();
        } else {
          autoStartTranslation();
        }
      };

      // 自分が前に登録したリスナーがあれば解除（二重登録防止）
      Object.entries(socketListenersRef.current).forEach(([event, handler]) => {
        socket.off(event as never, handler as never);
      });

      // イベントリスナーの登録と保存
      socket.on('offer', handleOffer);
      socket.on('answer', handleAnswer);
      socket.on('ice-candidate', handleIceCandidate);
      socket.on('peer-joined', handlePeerJoined);
      socket.on('peer-left', handlePeerLeft);
      socket.on('room-full', handleRoomFull);
      socket.on('call-replaced', handleCallReplaced);
      socket.on('translated-subtitle', handleTranslatedSubtitle);
      socket.on('call-audio-mode', handleCallAudioMode);
      socket.on('target-language', handleTargetLanguage);

      socketListenersRef.current = {
        'offer': handleOffer as (...args: unknown[]) => void,
        'answer': handleAnswer as (...args: unknown[]) => void,
        'ice-candidate': handleIceCandidate as (...args: unknown[]) => void,
        'peer-joined': handlePeerJoined as (...args: unknown[]) => void,
        'peer-left': handlePeerLeft as (...args: unknown[]) => void,
        'room-full': handleRoomFull as (...args: unknown[]) => void,
        'call-replaced': handleCallReplaced as (...args: unknown[]) => void,
        'translated-subtitle': handleTranslatedSubtitle as (...args: unknown[]) => void,
        'call-audio-mode': handleCallAudioMode as (...args: unknown[]) => void,
        'target-language': handleTargetLanguage as (...args: unknown[]) => void,
      };

      // 通話ルームに参加
      console.log(`[WebRTC] 🚪 ルーム ${roomId} に参加要求を送信`);
      const joinResponse = await requestJoinCall(socket, roomId);
      if (!joinResponse.ok) {
        throw new Error(getJoinFailureMessage(joinResponse));
      }
      sendCallAudioMode(audioInputMode);
      if (isMountedRef.current) {
        setHasJoined(true);
        onCallJoined?.();
        setConnectionState('waiting');
      }

    } catch (err) {
      console.error('[WebRTC] ❌ joinCallで致命的なエラーが発生しました:', err);

      // エラー発生時の緊急クリーンアップ（取得済みのストリームやコンテキストを完全に解放）
      activeVideoStream?.getTracks().forEach(t => t.stop());
      activeVoiceStream?.getTracks().forEach(t => t.stop());
      activeGuitarStream?.getTracks().forEach(t => t.stop());
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      remoteStreamRef.current?.getTracks().forEach(t => t.stop());
      voiceOnlyStreamRef.current = null;
      guitarStreamRef.current = null;
      activeVoiceDeviceIdRef.current = '';
      activeGuitarDeviceIdRef.current = '';
      rawVideoStreamRef.current = null;
      localStreamRef.current = null;
      remoteStreamRef.current = null;
      remoteAnalyserDisconnectRef.current = null;
      remoteGetLevelRef.current = null;
      remoteAudioPlayerRef.current = null;
      remotePlaybackHasGuitarRef.current = null;
      remotePlaybackStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      if (sharedContextRef.current) {
        sharedContextRef.current.close().catch(() => {});
        sharedContextRef.current = null;
      }
      webrtcRef.current?.close();
      webrtcRef.current = null;
      const failedJoinComposer = composerRef.current as MultiCameraComposer | null;
      failedJoinComposer?.destroy();
      composerRef.current = null;
      Object.entries(socketListenersRef.current).forEach(([event, handler]) => {
        getSocket().off(event as never, handler as never);
      });
      socketListenersRef.current = {};

      if (!isMountedRef.current) return;
      setError(getMediaDeviceFailureMessage(err));
    }
  };

  /** 通話を終了 */
  async function hangUp({ askCompletion = true }: HangUpOptions = {}) {
    if (endingCallRef.current) return;
    endingCallRef.current = true;
    setPeerLeftPromptVisible(false);
    setCompletionError('');

    // 1. WebRTC接続を先に閉じる（PeerConnectionがストリームを参照保持するため）
    webrtcRef.current?.close();
    webrtcRef.current = null;
    // 2. video要素のsrcObjectをnullにしてブラウザのカメラ参照を解放
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    // 3. リモート音声プレーヤーの停止
    remoteAudioPlayerRef.current?.stop();
    remoteAudioPlayerRef.current = null;
    remotePlaybackHasGuitarRef.current = null;
    remotePlaybackStreamRef.current = null;
    // ローカル専用クリック音を停止
    stopClickPlayback();
    clickAudioContextRef.current?.close().catch(() => {});
    clickAudioContextRef.current = null;
    setShowClickPopup(false);
    // 4. 翻訳の停止
    translationRef.current?.stop();
    translationRef.current = null;
    setTranslationError('');
    // 5. 全ストリームのトラックを停止
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    voiceOnlyStreamRef.current?.getTracks().forEach(t => t.stop());
    voiceOnlyStreamRef.current = null;
    guitarStreamRef.current?.getTracks().forEach(t => t.stop());
    guitarStreamRef.current = null;
    activeVoiceDeviceIdRef.current = '';
    activeGuitarDeviceIdRef.current = '';
    rawVideoStreamRef.current?.getTracks().forEach(t => t.stop());
    rawVideoStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach(t => t.stop());
    remoteStreamRef.current = null;
    // state側のストリームも停止＋stateリセット
    localStream?.getTracks().forEach(t => t.stop());
    remoteStream?.getTracks().forEach(t => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
    // 6. 音声アナライザーのdisconnect（MediaStreamSourceNodeの参照解放）
    localAnalyserDisconnectRef.current?.();
    localAnalyserDisconnectRef.current = null;
    remoteAnalyserDisconnectRef.current?.();
    remoteAnalyserDisconnectRef.current = null;
    localGetLevelRef.current = null;
    remoteGetLevelRef.current = null;
    peerAudioInputModeRef.current = 'mic-only';
    // 7. ギター音声ノードの切断
    guitarGainRef.current?.disconnect();
    guitarGainRef.current = null;
    voiceGainRef.current?.disconnect();
    voiceGainRef.current = null;
    // 8. 合成ストリームの全ノード切断
    mergedStreamDisconnectRef.current?.();
    mergedStreamDisconnectRef.current = null;
    // 8. AudioContextの解放（マイクのハードウェアアクセスを完全に開放）
    if (sharedContextRef.current) {
      sharedContextRef.current.close().catch(() => {});
      sharedContextRef.current = null;
    }
    // 9. マルチカメラComposerの破棄
    composerRef.current?.destroy();
    composerRef.current = null;
    setMultiCamActive(false);
    // レンダー中refアクセス回避用ステートのリセット
    setCurrentVideoDeviceId(undefined);
    setHasGuitarTrack(false);

    const socket = getSocket();
    socket.emit('leave-call');

    // レッスン記録の要約はバックグラウンドで非同期実行（UIブロックしない）
    if (isTeacher) {
      const transcript = subtitleLogsRef.current
        .map(log => `[${log.time}] ${log.speaker}: ${log.text}`)
        .join('\n');
      const savedRoomId = roomId;
      const savedRoomName = roomName;
      const savedDuration = callDuration;

      // 非同期で要約リクエストをページ側に委譲（チャンネルID等の文脈を付与するため）
      window.dispatchEvent(new CustomEvent('request-lesson-summary', {
        detail: {
          transcript,
          roomId: savedRoomId,
          roomName: savedRoomName,
          duration: savedDuration,
          language
        }
      }));
    }

    if (askCompletion && isTeacher) {
      setConnectionState('disconnected');
      setShowCompletionPrompt(true);
      return;
    }

    // state更新がフラッシュされた後にUIをクローズ（useEffectでsrcObjectが再設定されるのを防ぐ）
    queueMicrotask(() => onClose());
  }

  const confirmLessonComplete = async () => {
    if (completionSaving) return;
    setCompletionSaving(true);
    setCompletionError('');

    try {
      const res = await fetch(`/api/rooms/${roomId}/complete-lesson`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || (language === 'en' ? 'Failed to record lesson completion.' : 'レッスン完了の記録に失敗しました。'));
      }
      console.log(`🎸 レッスン完了！ 通算${data.totalLessons}回目`);
      queueMicrotask(() => onClose());
    } catch (err) {
      setCompletionError(err instanceof Error ? err.message : (language === 'en' ? 'Failed to record lesson completion.' : 'レッスン完了の記録に失敗しました。'));
      setCompletionSaving(false);
    }
  };

  const closeWithoutLessonComplete = () => {
    queueMicrotask(() => onClose());
  };

  /** ミュート切替 */
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setLocalAudioTracksEnabled(!nextMuted);
    setIsMuted(nextMuted);
  };

  /** カメラ切替 */
  const toggleCamera = () => {
    const tracks = localStreamRef.current?.getVideoTracks();
    if (!tracks || tracks.length === 0) return;
    const newEnabled = !tracks[0].enabled;
    tracks.forEach(t => { t.enabled = newEnabled; });
    setIsCameraOff(!newEnabled);
  };

  /** 通話中のマルチカメラON/OFF切替 */
  const toggleMultiCamera = async (cameraDeviceId?: string) => {
    if (!webrtcRef.current || !localStreamRef.current) return;

    if (multiCamActive && !cameraDeviceId) {
      // マルチカメラをOFFにする → 元のシングルカメラに戻す
      console.log('[MultiCam] マルチカメラを無効化...');
      if (composerRef.current) {
        await composerRef.current.removeSubCamera();
      } else if (rawVideoStreamRef.current) {
        const activeMainDeviceId = currentVideoDeviceId || mainCameraId || rawVideoStreamRef.current.getVideoTracks()[0]?.getSettings().deviceId || 'default';
        const { track: fixedVideoTrack } = await prepareFixedVideoOutput(rawVideoStreamRef.current, activeMainDeviceId);
        await applyOutgoingVideoTrack(fixedVideoTrack, { warnOnly: true });
      }
      setMultiCamActive(false);
      setShowCameraPopup(false);
    } else {
      // マルチカメラをONにする → 2台目のカメラを追加して合成
      const targetCamId = cameraDeviceId || subCameraId;
      if (!targetCamId) return;

      console.log('[MultiCam] マルチカメラを有効化...');
      try {
        if (!rawVideoStreamRef.current) return;
        const activeMainDeviceId = currentVideoDeviceId || mainCameraId || rawVideoStreamRef.current.getVideoTracks()[0]?.getSettings().deviceId || 'default';
        const { track: fixedVideoTrack, multiActive: nextMultiActive } = await prepareFixedVideoOutput(
          rawVideoStreamRef.current,
          activeMainDeviceId,
          targetCamId,
        );
        await applyOutgoingVideoTrack(fixedVideoTrack, { warnOnly: true });

        setMultiCamActive(nextMultiActive);
        if (nextMultiActive) setSubCameraId(targetCamId);
        setShowCameraPopup(false);
        console.log('[MultiCam] ✅ マルチカメラ有効化成功');
      } catch (e) {
        console.error('[MultiCam] マルチカメラの有効化に失敗:', e);
      }
    }
  };

  /** 通話時間のフォーマット */
  const formatDuration = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const statusText = (() => {
    switch (connectionState) {
      case 'waiting': return language === 'en' ? 'Waiting for peer...' : '相手の参加を待っています...';
      case 'connecting': return language === 'en' ? 'Connecting...' : '接続中...';
      case 'connected': return language === 'en' ? `Call duration ${formatDuration(callDuration)}` : `通話中 ${formatDuration(callDuration)}`;
      case 'disconnected': return language === 'en' ? 'Disconnected' : '切断されました';
      default: return language === 'en' ? 'Preparing...' : '準備中...';
    }
  })();
  // デバイス一覧取得（デュアルモード選択時に呼ばれる）
  const loadAudioDevices = useCallback(async () => {
    setDevicesLoading(true);
    setAudioDeviceError('');
    try {
      // デバイスラベルを取得するために一時的にマイク許可を取得
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop()); // すぐ解放
      const devices = await enumerateAudioDevices();
      setAudioDevices(devices);
      if (devices.length === 0) {
        setAudioDeviceError(language === 'en' ? 'No microphone was found.' : 'マイクが見つかりません。');
      }
      // デフォルト選択（最初のデバイスを声用、2番目をギター用に）
      if (devices.length >= 1 && !selectedVoiceDevice) setSelectedVoiceDevice(devices[0].deviceId);
      if (devices.length >= 2 && !selectedGuitarDevice) setSelectedGuitarDevice(devices[1].deviceId);
    } catch (err) {
      console.error('デバイス列挙エラー:', err);
      setAudioDevices([]);
      setAudioDeviceError(language === 'en'
        ? 'Microphone access was denied. Please check your browser settings.'
        : 'マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。');
    }
    setDevicesLoading(false);
  }, [language, selectedVoiceDevice, selectedGuitarDevice]);

  // 初期デバイスロード（マウント時のデバイス列挙は正当なuseEffect使用例）
  useEffect(() => {
    if (!hasJoined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (audioDevices.length === 0) loadAudioDevices();
      if (availableCameras.length === 0) loadCameraDevices();
    }
  }, [hasJoined, audioDevices.length, availableCameras.length, loadAudioDevices, loadCameraDevices]);

  const audioDeviceMissing = audioDevices.length === 0 || !selectedVoiceDevice;
  const dualInputInvalid = audioInputMode === 'dual' && (
    !selectedVoiceDevice ||
    !selectedGuitarDevice ||
    selectedVoiceDevice === selectedGuitarDevice ||
    audioDevices.length < 2
  );
  const cameraDeviceMissing = availableCameras.length === 0 || !mainCameraId;
  const multiCameraInvalid = multiCameraEnabled && (
    availableCameras.length < 2 ||
    !subCameraId ||
    mainCameraId === subCameraId
  );
  const startDisabled = devicesLoading || camerasLoading || audioDeviceMissing || dualInputInvalid || cameraDeviceMissing || multiCameraInvalid;
  const deviceSettingsInvalid = audioInputMode === 'dual' && (
    !selectedVoiceDevice ||
    !selectedGuitarDevice ||
    selectedVoiceDevice === selectedGuitarDevice
  );
  const startDisabledReason = (() => {
    if (devicesLoading || camerasLoading) return language === 'en' ? 'Detecting devices...' : 'デバイスを検出中です。';
    if (audioDeviceMissing) return language === 'en' ? 'A microphone is required to start the call.' : '通話を開始するにはマイクが必要です。';
    if (dualInputInvalid) return language === 'en' ? 'Please choose different devices for voice and guitar.' : '声用マイクとギター入力には別々のデバイスを選んでください。';
    if (cameraDeviceMissing) return language === 'en' ? 'A camera is required to start the call.' : '通話を開始するにはカメラが必要です。';
    if (multiCameraInvalid) return language === 'en' ? 'Please choose two different cameras for multi-camera mode.' : 'マルチカメラでは別々のカメラを2台選んでください。';
    return '';
  })();

  // ===== 参加前画面 =====
  if (!hasJoined) {
    return (
      <div className={`lesson-view ${compact ? 'lesson-view--compact' : ''}`}>
        <div className="lesson-join">
          <h2 className="lesson-join__title">{language === 'en' ? 'Start Lesson' : 'レッスンを開始'}</h2>
          {error && <div className="lesson-error lesson-error--join">{error}</div>}

          {/* ===== 音声入力モード選択 ===== */}
          {appMode === 'guitar' && (
            <div className="lesson-audio-mode">
              <p className="lesson-audio-mode__label">{language === 'en' ? 'Audio Input Mode' : '音声入力モード'}</p>
              <div className="lesson-audio-mode__options">
                <button
                  className={`lesson-audio-mode__btn ${audioInputMode === 'mic-only' ? 'active' : ''}`}
                  onClick={() => {
                    setAudioInputMode('mic-only');
                    if (audioDevices.length === 0) loadAudioDevices();
                  }}
                >
                  <strong>🎤 {language === 'en' ? 'Microphone Only' : 'マイクのみ'}</strong>
                  <small className="lesson-audio-mode__btn-desc">{language === 'en' ? 'Mic captures both voice and guitar' : '声もギターもマイクで拾う'}</small>
                </button>
                <button
                  className={`lesson-audio-mode__btn ${audioInputMode === 'dual' ? 'active' : ''}`}
                  onClick={() => {
                    setAudioInputMode('dual');
                    if (audioDevices.length === 0) loadAudioDevices();
                  }}
                >
                  <strong>🎤🎸 {language === 'en' ? 'Mic + Line In' : 'マイク＋ライン入力'}</strong>
                  <small className="lesson-audio-mode__btn-desc">{language === 'en' ? 'Voice via Mic, Guitar via Line-In' : '声はマイク、ギターは直入力'}</small>
                </button>
              </div>
              <p className="lesson-audio-mode__lock-note">
                {language === 'en'
                  ? 'Audio input mode can be changed only before starting the call.'
                  : '音声入力モードは通話開始前だけ変更できます。'}
              </p>
            </div>
          )}

          {/* ===== デバイス選択（常時表示） ===== */}
          <div className="lesson-device-select">
            {devicesLoading ? (
              <p className="lesson-device-select__loading">{language === 'en' ? 'Detecting devices...' : 'デバイスを検出中...'}</p>
            ) : audioDevices.length === 0 ? (
              <div className="lesson-device-select__warning">
                <span>⚠️</span>
                <span>{audioDeviceError || (language === 'en' ? 'No microphone was found. Please connect one and retry.' : 'マイクが見つかりません。接続してから再検出してください。')}</span>
                <button className="lesson-device-select__retry" onClick={loadAudioDevices}>
                  {language === 'en' ? 'Retry' : '再検出'}
                </button>
              </div>
            )
            : audioInputMode === 'dual' && audioDevices.length < 2 ? (
              <div className="lesson-device-select__warning">
                <span>⚠️</span>
                <span>{language === 'en' ? 'At least 2 audio input devices are required. Please connect an audio interface and retry.' : '2つ以上のオーディオ入力デバイスが必要です。オーディオインターフェイスを接続してから再試行してください。'}</span>
                <button className="lesson-device-select__retry" onClick={loadAudioDevices}>
                  {language === 'en' ? 'Retry' : '再検出'}
                </button>
              </div>
            ) : audioInputMode === 'mic-only' ? (
              <div className="lesson-device-select__row">
                <label className="lesson-device-select__label">
                  <span className="lesson-device-select__label-icon">🎤</span>
                  {language === 'en' ? 'Microphone' : 'マイク'}
                </label>
                <select
                  className="lesson-device-select__dropdown"
                  value={selectedVoiceDevice}
                  onChange={(e) => setSelectedVoiceDevice(e.target.value)}
                >
                  {audioDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
                <span className="lesson-device-select__hint">
                  {appMode === 'standard'
                    ? (language === 'en' ? 'Noise Cancellation ON' : 'ノイズキャンセルON')
                    : (language === 'en' ? 'Noise Cancellation OFF (Raw)' : 'ノイズキャンセルOFF（生音）')}
                </span>
              </div>
            ) : (
              <>
                <div className="lesson-device-select__pair">
                  <div className="lesson-device-select__row">
                    <label className="lesson-device-select__label">
                      <span className="lesson-device-select__label-icon">🎤</span>
                      {language === 'en' ? 'Voice Microphone' : '声用マイク'}
                    </label>
                    <select
                      className="lesson-device-select__dropdown"
                      value={selectedVoiceDevice}
                      onChange={(e) => setSelectedVoiceDevice(e.target.value)}
                    >
                      {audioDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                    <span className="lesson-device-select__hint">{language === 'en' ? 'Noise Cancellation ON' : 'ノイズキャンセルON'}</span>
                  </div>
                  <div className="lesson-device-select__row">
                    <label className="lesson-device-select__label">
                      <span className="lesson-device-select__label-icon">🎸</span>
                      {language === 'en' ? 'Guitar Line-In' : 'ギター入力'}
                    </label>
                    <select
                      className="lesson-device-select__dropdown"
                      value={selectedGuitarDevice}
                      onChange={(e) => setSelectedGuitarDevice(e.target.value)}
                    >
                      {audioDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                      ))}
                    </select>
                    <span className="lesson-device-select__hint">{language === 'en' ? 'Noise Cancellation OFF (Raw)' : 'ノイズキャンセルOFF（生音）'}</span>
                  </div>
                </div>
                {selectedVoiceDevice === selectedGuitarDevice && (
                  <p className="lesson-device-select__same-warning">
                    ⚠️ {language === 'en' ? 'Same device selected for voice and guitar. Please choose different devices.' : '声用とギター用に同じデバイスが選択されています。別のデバイスを選んでください。'}
                  </p>
                )}
              </>
            )}
          </div>

          {/* ===== カメラモード選択 ===== */}
          <div className="lesson-audio-mode">
            <p className="lesson-audio-mode__label">{language === 'en' ? 'Camera Mode' : 'カメラモード'}</p>
            <div className="lesson-audio-mode__options">
              <button
                className={`lesson-audio-mode__btn ${!multiCameraEnabled ? 'active' : ''}`}
                onClick={() => {
                  setMultiCameraEnabled(false);
                  if (availableCameras.length === 0) loadCameraDevices();
                }}
              >
                <strong>📷 {language === 'en' ? 'Single Camera' : 'カメラ1台'}</strong>
                <small className="lesson-audio-mode__btn-desc">{language === 'en' ? 'Show hands with one camera' : '手元を1台のカメラで映す'}</small>
              </button>
              <button
                className={`lesson-audio-mode__btn ${multiCameraEnabled ? 'active' : ''}`}
                onClick={() => {
                  setMultiCameraEnabled(true);
                  if (availableCameras.length === 0) loadCameraDevices();
                }}
              >
                <strong>📷📷 {language === 'en' ? 'Multi-Camera' : 'マルチカメラ'}</strong>
                <small className="lesson-audio-mode__btn-desc">{language === 'en' ? 'Show hands + face simultaneously' : '手元＋顔を同時に映す'}</small>
              </button>
            </div>
          </div>

          {/* ===== カメラデバイス選択 ===== */}
          <div className="lesson-device-select">
            {camerasLoading ? (
              <p className="lesson-device-select__loading">{language === 'en' ? 'Detecting cameras...' : 'カメラを検出中...'}</p>
            ) : availableCameras.length === 0 ? (
              <div className="lesson-device-select__warning">
                <span>⚠️</span>
                <span>{cameraDeviceError || (language === 'en' ? 'No camera was found. Please connect one and retry.' : 'カメラが見つかりません。接続してから再検出してください。')}</span>
                <button className="lesson-device-select__retry" onClick={loadCameraDevices}>
                  {language === 'en' ? 'Retry' : '再検出'}
                </button>
              </div>
            )
            : !multiCameraEnabled ? (
              <div className="lesson-device-select__row">
                <label className="lesson-device-select__label">
                  <span className="lesson-device-select__label-icon">📷</span>
                  {language === 'en' ? 'Camera' : 'カメラ'}
                </label>
                <select
                  className="lesson-device-select__dropdown"
                  value={mainCameraId}
                  onChange={(e) => setMainCameraId(e.target.value)}
                >
                  {availableCameras.map(c => (
                    <option key={c.deviceId} value={c.deviceId}>{c.label || `Camera ${availableCameras.indexOf(c) + 1}`}</option>
                  ))}
                </select>
              </div>
            ) : availableCameras.length < 2 ? (
              <div className="lesson-device-select__warning">
                <span>⚠️</span>
                <span>{language === 'en' ? 'At least 2 cameras are required. Please connect an external camera and retry.' : '2台以上のカメラが必要です。外部カメラを接続してから再試行してください。'}</span>
                <button className="lesson-device-select__retry" onClick={loadCameraDevices}>
                  {language === 'en' ? 'Retry' : '再検出'}
                </button>
              </div>
            ) : (
              <>
                <div className="lesson-device-select__pair">
                  <div className="lesson-device-select__row">
                    <label className="lesson-device-select__label">
                      <span className="lesson-device-select__label-icon">🎸</span>
                      {language === 'en' ? 'Main Camera' : 'メインカメラ'}
                    </label>
                    <select
                      className="lesson-device-select__dropdown"
                      value={mainCameraId}
                      onChange={(e) => setMainCameraId(e.target.value)}
                    >
                      {availableCameras.map(c => (
                        <option key={c.deviceId} value={c.deviceId} disabled={c.deviceId === subCameraId}>{c.label || `Camera ${availableCameras.indexOf(c) + 1}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="lesson-device-select__row">
                    <label className="lesson-device-select__label">
                      <span className="lesson-device-select__label-icon">😊</span>
                      {language === 'en' ? 'Sub Camera (PiP)' : 'サブカメラ（小窓）'}
                    </label>
                    <select
                      className="lesson-device-select__dropdown"
                      value={subCameraId}
                      onChange={(e) => setSubCameraId(e.target.value)}
                    >
                      {availableCameras.map(c => (
                        <option key={c.deviceId} value={c.deviceId} disabled={c.deviceId === mainCameraId}>{c.label || `Camera ${availableCameras.indexOf(c) + 1}`}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {mainCameraId === subCameraId && mainCameraId !== '' && (
                  <p className="lesson-device-select__same-warning">
                    ⚠️ {language === 'en' ? 'Same camera selected for hands and face. Please choose different cameras.' : '手元用と顔用に同じカメラが選択されています。別のカメラを選んでください。'}
                  </p>
                )}
              </>
            )}
          </div>

          {/* ===== AI翻訳 ===== */}
          <div className="lesson-translation-row">
            <label className="lesson-toggle">
              <input
                type="checkbox"
                checked={translationEnabled}
                disabled={PUBLIC_DEMO}
                title={PUBLIC_DEMO ? AI_DISABLED_MESSAGE : undefined}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setTranslationEnabled(enabled);
                  translationEnabledRef.current = enabled;
                  setTranslationError('');
                  if (!enabled) setSubtitle('');
                  if (hasJoined) sendTranslationPreference(enabled);
                }}
              />
              <span className="lesson-toggle__slider" />
            </label>
            <span className="lesson-translation-row__label">🌍 {language === 'en' ? 'AI Translation' : 'AI翻訳'}</span>
            <select
              className="lesson-device-select__dropdown lesson-translation-row__select"
              value={targetLanguage}
              disabled={!translationEnabled}
              style={{ opacity: translationEnabled ? 1 : 0.3 }}
              onChange={(e) => {
                const newLang = e.target.value;
                setManualTargetLanguage(newLang);
                targetLanguageRef.current = newLang;
                localStorage.setItem('actlas_target_language', newLang);
                if (hasJoined) sendTranslationPreference();
              }}
            >
              {LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.code}>{lang.label}</option>
              ))}
            </select>
          </div>
          <p className="lesson-translation-row__hint">
            {PUBLIC_DEMO
              ? AI_DISABLED_MESSAGE
              : language === 'en'
              ? 'This turns the subtitles you see on or off. When off, you will not receive translated subtitles.'
              : 'これは自分が見る字幕のオン・オフです。オフにすると、自分の画面には翻訳字幕が表示されません。'}
          </p>

          {/* 注意事項 */}
          <div className="lesson-join__warnings" style={{
            background: 'rgba(255,106,54,0.1)',
            border: '1px solid rgba(255,106,54,0.3)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginTop: '8px',
            marginBottom: '12px',
            textAlign: 'left',
            fontSize: '12px',
            color: 'rgba(255,255,255,0.9)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '16px', lineHeight: 1 }}>🎧</span>
              <span><strong>{language === 'en' ? 'Please use earphones' : 'イヤフォンをご使用ください'}</strong><br/><span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>{language === 'en' ? 'To prevent audio feedback from the speakers into the mic.' : 'スピーカーからの音がマイクに入り、ハウリングの原因になります。'}</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '16px', lineHeight: 1 }}>📹</span>
              <span><strong>{language === 'en' ? 'Camera connection required' : 'カメラの接続が必要です'}</strong><br/><span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>{language === 'en' ? 'A camera is required to start the call to show your hands.' : '手元を映すため、カメラがないと通話を開始できません。'}</span></span>
            </div>
            {!isStandalone && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '16px', lineHeight: 1 }}>🌐</span>
                <span><strong>{language === 'en' ? 'Google Chrome recommended' : 'Google Chrome推奨'}</strong><br/><span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>{language === 'en' ? 'Some browsers like Safari may experience audio or video issues.' : 'Safariなど一部のブラウザでは音声や映像が途切れる場合があります。'}</span></span>
              </div>
            )}
          </div>

          <button
            className="lesson-join__start-btn"
            onClick={joinCall}
            disabled={startDisabled}
          >
            {language === 'en' ? 'Start Call' : '通話を開始する'}
          </button>
          {startDisabledReason && (
            <p className="lesson-join__disabled-reason">{startDisabledReason}</p>
          )}
        </div>
      </div>
    );
  }

  // ===== 通話中画面 =====

  // 先生/生徒の名前をインジケーターに表示するための変数
  // 先生ビュー: 相手（生徒）= roomName, 自分 = userName
  // 生徒ビュー: 相手（先生）= roomName, 自分 = userName
  const remoteName = roomName;
  const localName = userName;



  return (
    <div className={`lesson-view ${compact ? 'lesson-view--compact' : ''}`}>
      {error && <div className="lesson-error">{error}</div>}

      {peerLeftPromptVisible && !showCompletionPrompt && (
        <div className="lesson-call-notice">
          <div className="lesson-call-notice__content">
            <strong>{language === 'en' ? 'Your peer left the call.' : '相手が通話から退出しました。'}</strong>
            <span>{language === 'en' ? 'You can wait for them to rejoin, or finish the lesson now.' : '再参加を待つか、このままレッスンを終了して記録できます。'}</span>
          </div>
          <div className="lesson-call-notice__actions">
            <button type="button" className="lesson-call-notice__btn" onClick={() => setPeerLeftPromptVisible(false)}>
              {language === 'en' ? 'Keep Waiting' : 'このまま待つ'}
            </button>
            <button type="button" className="lesson-call-notice__btn lesson-call-notice__btn--primary" onClick={() => hangUp()}>
              {language === 'en' ? 'Finish Lesson' : '終了して記録へ'}
            </button>
          </div>
        </div>
      )}

      {showCompletionPrompt && (
        <div className="lesson-completion-overlay">
          <div className="lesson-completion-dialog">
            <h3>{language === 'en' ? 'Was this lesson completed?' : 'このレッスンは完了しましたか？'}</h3>
            <p>
              {language === 'en'
                ? "If completed, the student's lesson count will increase by one."
                : '完了として記録すると、生徒のレッスン回数が1回増えます。'}
            </p>
            {completionError && <div className="lesson-completion-dialog__error">{completionError}</div>}
            <div className="lesson-completion-dialog__actions">
              <button type="button" className="lesson-completion-dialog__btn" onClick={closeWithoutLessonComplete} disabled={completionSaving}>
                {language === 'en' ? 'No, just close' : '記録せず閉じる'}
              </button>
              <button type="button" className="lesson-completion-dialog__btn lesson-completion-dialog__btn--primary" onClick={confirmLessonComplete} disabled={completionSaving}>
                {completionSaving
                  ? (language === 'en' ? 'Recording...' : '記録中...')
                  : (language === 'en' ? 'Yes, completed' : '完了として記録')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 映像エリア */}
      <div className="lesson-videos">
        <div className="lesson-video-remote">
          <video ref={remoteVideoRef} autoPlay playsInline />
          {connectionState !== 'connected' && (
            <div className="lesson-video-placeholder">
              <div className="lesson-waiting-rings">
                <span>🎥</span>
              </div>
              <p>{statusText}</p>
            </div>
          )}
        </div>
        <div className="lesson-video-local">
          <video ref={localVideoRef} autoPlay playsInline muted />
          {isCameraOff && (
            <div className="lesson-video-off">{language === 'en' ? 'Camera OFF' : 'カメラOFF'}</div>
          )}
        </div>

        {/* 字幕 */}
        {translationEnabled && subtitle && (
          <div className="lesson-subtitle">
            <span>{subtitle}</span>
          </div>
        )}
      </div>

      {/* === 統合コントロールバー（ボタン + ステータス + 音声レベル を1行に） === */}
      <div className="lesson-controls">
        {/* 左: ボタン群 */}
        <div className="lesson-controls__buttons">
          <button
            className={`lesson-ctrl-btn ${isMuted ? 'lesson-ctrl-btn--danger' : ''}`}
            onClick={toggleMute}
            title={isMuted ? 'ミュート解除' : 'ミュート'}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            className={`lesson-ctrl-btn ${isCameraOff ? 'lesson-ctrl-btn--danger' : ''}`}
            onClick={toggleCamera}
            title={isCameraOff ? 'カメラON' : 'カメラOFF'}
          >
            {isCameraOff ? <VideoOff size={20} /> : <Video size={20} />}
          </button>
          {appMode === 'guitar' && (
            <div className="lesson-multicam-wrapper" ref={clickPopupRef}>
              <button
                className={`lesson-ctrl-btn ${showClickPopup || isClickPlaying ? 'lesson-ctrl-btn--active' : ''}`}
                onClick={() => setShowClickPopup(prev => !prev)}
                title={language === 'en' ? 'Local Click Track' : 'クリック音'}
              >
                <Timer size={20} />
              </button>
              {showClickPopup && (
                <div className="lesson-click-popup">
                  <div className="lesson-click-popup__header">
                    <span className="lesson-click-popup__title">{language === 'en' ? 'Click' : 'クリック'}</span>
                    <span className={`lesson-click-popup__state ${isClickPlaying ? 'is-playing' : ''}`}>
                      {isClickPlaying ? (language === 'en' ? 'Playing' : '再生中') : (language === 'en' ? 'Stopped' : '停止中')}
                    </span>
                  </div>
                  <div className="lesson-click-popup__tempo">
                    <button
                      type="button"
                      className="lesson-click-popup__step"
                      onClick={() => setClickBpm(prev => clampClickBpm(prev - 5))}
                      title={language === 'en' ? 'Lower BPM' : 'BPMを下げる'}
                    >
                      -
                    </button>
                    <label className="lesson-click-popup__bpm">
                      <input
                        type="number"
                        min={CLICK_BPM_MIN}
                        max={CLICK_BPM_MAX}
                        value={clickBpm}
                        onChange={(e) => setClickBpm(clampClickBpm(Number(e.target.value)))}
                      />
                      <span>BPM</span>
                    </label>
                    <button
                      type="button"
                      className="lesson-click-popup__step"
                      onClick={() => setClickBpm(prev => clampClickBpm(prev + 5))}
                      title={language === 'en' ? 'Raise BPM' : 'BPMを上げる'}
                    >
                      +
                    </button>
                  </div>
                  <input
                    type="range"
                    min={CLICK_BPM_MIN}
                    max={CLICK_BPM_MAX}
                    value={clickBpm}
                    onChange={(e) => setClickBpm(clampClickBpm(Number(e.target.value)))}
                    className="lesson-click-popup__slider"
                    aria-label={language === 'en' ? 'BPM' : 'BPM'}
                  />
                  <button
                    type="button"
                    className={`lesson-click-popup__play ${isClickPlaying ? 'is-playing' : ''}`}
                    onClick={isClickPlaying ? stopClickPlayback : startClickPlayback}
                  >
                    {isClickPlaying ? <Pause size={16} /> : <Play size={16} />}
                    <span>{isClickPlaying ? (language === 'en' ? 'Stop' : '停止') : (language === 'en' ? 'Play' : '再生')}</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {/* スクショボタン */}
          <div className="lesson-multicam-wrapper" ref={screenshotPopupRef}>
            <button
              className={`lesson-ctrl-btn ${showScreenshotPopup ? 'lesson-ctrl-btn--active' : ''}`}
              onClick={() => setShowScreenshotPopup(prev => !prev)}
              title={language === 'en' ? 'Take Screenshot' : 'スクショを撮る'}
            >
              <Focus size={20} />
            </button>
            {showScreenshotPopup && (
              <div className="lesson-camera-popup lesson-camera-popup--aligned" style={{ width: '180px', bottom: '50px', left: 0, transform: 'none' }}>
                <div className="lesson-camera-popup__title">{language === 'en' ? 'Select Target' : 'スクショ対象を選択'}</div>
                <button 
                  className="lesson-camera-popup__item" 
                  onClick={() => takeScreenshot('remote')}
                  disabled={connectionState !== 'connected'}
                  style={connectionState !== 'connected' ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                >
                  <span className="lesson-camera-popup__cam-icon"><User size={16} /></span>
                  <span className="lesson-camera-popup__cam-name">{language === 'en' ? 'Peer Video' : '相手の映像'}</span>
                </button>
                <button className="lesson-camera-popup__item" onClick={() => takeScreenshot('local')}>
                  <span className="lesson-camera-popup__cam-icon"><Camera size={16} /></span>
                  <span className="lesson-camera-popup__cam-name">{language === 'en' ? 'My Video' : '自分の映像'}</span>
                </button>
              </div>
            )}
          </div>
          {/* マルチカメラトグル */}
          <div className="lesson-multicam-wrapper" ref={cameraPopupRef}>
            <button
              className={`lesson-ctrl-btn ${multiCamActive ? 'lesson-ctrl-btn--active' : ''}`}
              onClick={async () => {
                if (availableCameras.length === 0) await loadCameraDevices();
                if (multiCamActive) {
                  // ON→OFF: マルチカメラを無効化
                  toggleMultiCamera();
                } else {
                  // OFF→ON: カメラ選択ポップアップを表示
                  setShowCameraPopup(prev => !prev);
                }
              }}
              title={multiCamActive ? 'マルチカメラOFF' : 'マルチカメラON'}
            >
              {multiCamActive ? <MonitorSmartphone size={20} /> : <MonitorSmartphone size={20} style={{ opacity: 0.6 }} />}
            </button>
            {showCameraPopup && !multiCamActive && (
              <div className="lesson-camera-popup lesson-camera-popup--aligned" style={{ width: '200px', bottom: '50px', left: '-40px', transform: 'none' }}>
                <div className="lesson-camera-popup__title">{language === 'en' ? 'Select 2nd Camera' : '2台目のカメラを選択'}</div>
                {availableCameras.length < 2 ? (
                  <div className="lesson-camera-popup__empty">
                    {language === 'en' ? 'Only 1 camera detected' : 'カメラが1台しか検出されません'}
                    <button className="lesson-camera-popup__retry" onClick={loadCameraDevices}>{language === 'en' ? 'Retry' : '再検出'}</button>
                  </div>
                ) : (
                  availableCameras
                    .filter(c => {
                      // 現在使用中のメインカメラのdeviceIdを除外（state経由で参照）
                      return c.deviceId !== currentVideoDeviceId;
                    })
                    .map(c => (
                      <button
                        key={c.deviceId}
                        className="lesson-camera-popup__item"
                        onClick={() => toggleMultiCamera(c.deviceId)}
                      >
                        <span className="lesson-camera-popup__cam-icon"><Camera size={16} /></span>
                        <span className="lesson-camera-popup__cam-name">{c.label || 'カメラ'}</span>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
          {/* マルチカメラ入れ替えボタン（マルチカメラ有効時のみ） */}
          {multiCamActive && (
            <button
              className="lesson-ctrl-btn"
              onClick={async () => {
                if (composerRef.current) {
                  await composerRef.current.swapCameras();
                  const temp = mainCameraId;
                  setMainCameraId(subCameraId);
                  setSubCameraId(temp);
                }
              }}
              title={language === 'en' ? "Swap Main/Sub Cameras" : "メインカメラとサブカメラを入れ替える"}
            >
              <RefreshCcw size={20} />
            </button>
          )}
          {/* 設定ボタン */}
          <div className="lesson-multicam-wrapper" ref={settingsPopupRef}>
            <button
              className={`lesson-ctrl-btn ${showSettingsPopup ? 'lesson-ctrl-btn--active' : ''}`}
              onClick={async () => {
                if (audioDevices.length === 0) await loadAudioDevices();
                if (availableCameras.length === 0) await loadCameraDevices();
                setShowSettingsPopup(prev => !prev);
              }}
              title={language === 'en' ? 'Device Settings' : 'デバイス設定'}
            >
              <Settings size={20} />
            </button>
              {showSettingsPopup && (
                <div className="lesson-camera-popup lesson-camera-popup--aligned" style={{ width: '280px', maxWidth: 'calc(100vw - 16px)', bottom: '54px', left: '-80px', right: 'auto', transform: 'none', zIndex: 100 }}>
                  <div className="lesson-camera-popup__title">{language === 'en' ? 'Device Settings' : 'デバイス設定'}</div>
                  
                  <div style={{ padding: '8px 12px', fontSize: '13px', textAlign: 'left' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <label style={{ display: 'block', marginBottom: '4px', color: '#aaa' }}>{language === 'en' ? 'Main Camera' : 'メインカメラ'}</label>
                      <select value={mainCameraId || ''} onChange={(e) => setMainCameraId(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', backgroundColor: '#222', color: '#fff', border: '1px solid #444' }}>
                        {availableCameras.map(c => <option key={c.deviceId} value={c.deviceId} disabled={multiCamActive && c.deviceId === subCameraId}>{c.label}</option>)}
                      </select>
                    </div>

                    {multiCamActive && (
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', color: '#aaa' }}>{language === 'en' ? 'Sub Camera' : 'サブカメラ'}</label>
                        <select value={subCameraId || ''} onChange={(e) => setSubCameraId(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', backgroundColor: '#222', color: '#fff', border: '1px solid #444' }}>
                          {availableCameras.map(c => <option key={c.deviceId} value={c.deviceId} disabled={c.deviceId === mainCameraId}>{c.label}</option>)}
                        </select>
                      </div>
                    )}

                    <div style={{ marginBottom: '8px' }}>
                      <label style={{ display: 'block', marginBottom: '4px', color: '#aaa' }}>{language === 'en' ? 'Microphone' : 'マイク'}</label>
                      <select value={selectedVoiceDevice || ''} onChange={(e) => setSelectedVoiceDevice(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', backgroundColor: '#222', color: '#fff', border: '1px solid #444' }}>
                        {audioDevices.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
                      </select>
                    </div>

                    {audioInputMode === 'dual' && appMode === 'guitar' && (
                      <div style={{ marginBottom: '8px' }}>
                        <label style={{ display: 'block', marginBottom: '4px', color: '#aaa' }}>{language === 'en' ? 'Line-In (Guitar)' : 'ライン入力 (ギター)'}</label>
                        <select value={selectedGuitarDevice || ''} onChange={(e) => setSelectedGuitarDevice(e.target.value)} style={{ width: '100%', padding: '6px', borderRadius: '4px', backgroundColor: '#222', color: '#fff', border: '1px solid #444' }}>
                          {audioDevices.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
                        </select>
                      </div>
                    )}

                    {deviceSettingsInvalid && (
                      <p className="lesson-device-select__same-warning" style={{ textAlign: 'left', margin: '6px 0 0' }}>
                        ⚠️ {language === 'en' ? 'Choose different devices for voice and guitar before applying.' : '適用する前に、声用とギター用で別々のデバイスを選んでください。'}
                      </p>
                    )}

                    <button
                      className="lesson-join__btn"
                      style={{ width: '100%', marginTop: '12px', padding: '8px' }}
                      onClick={applyDeviceSettings}
                      disabled={deviceSettingsInvalid}
                    >
                      {language === 'en' ? 'Apply' : '適用'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          <button
            className="lesson-ctrl-btn"
            onClick={() => hangUp()}
            title={language === 'en' ? "End Call" : "通話終了"}
          >
            <Phone size={20} style={{ transform: 'rotate(135deg)' }} />
          </button>
        </div>

        {/* 中央: ステータス（通話時間 + 翻訳状態） */}
        <div className="lesson-controls__status">
          <span className={`lesson-status-badge lesson-status--${connectionState}`}>
            {statusText}
          </span>
          {translationEnabled && translationState !== 'idle' && (
            <span className={`lesson-translation-badge lesson-translation--${translationState}`}>
              🌍 {translationState === 'active' ? (language === 'en' ? 'Translating' : '翻訳中') : translationState === 'connecting' ? (language === 'en' ? 'Connecting' : '接続中') : translationState === 'reconnecting' ? (language === 'en' ? 'Reconnecting' : '再接続中') : ''}
            </span>
          )}
          {translationEnabled && translationError && (
            <span className="lesson-translation-error">
              {translationError}
            </span>
          )}
        </div>

        {/* 右: 音声レベルメーター + 音量スライダー */}
        <div className="lesson-controls__right">
          {connectionState === 'connected' && (
            <div className="lesson-controls__levels">
              <div className="lesson-level">
                <span className="lesson-level__name">{remoteName}</span>
                <div className="lesson-level__bar">
                  <div className="lesson-level__fill" style={{ width: `${remoteAudioLevel}%` }} />
                </div>
              </div>
              <div className="lesson-level">
                <span className="lesson-level__name">{localName}</span>
                <div className="lesson-level__bar">
                  <div className="lesson-level__fill lesson-level__fill--local" style={{ width: `${localAudioLevel}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* 音量スライダー（常時表示） */}
          {connectionState === 'connected' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="lesson-volume-inline">
                <span className="lesson-volume-inline__icon" title={hasGuitarTrack ? (language === 'en' ? "Peer's Mic Volume" : "相手のマイク音量") : (language === 'en' ? "Peer's Volume" : "相手の音量")}>{hasGuitarTrack ? "🎤" : "🔊"}</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={remoteVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRemoteVolume(v);
                    remoteAudioPlayerRef.current?.setVolume(v);
                  }}
                  className="lesson-volume__slider"
                />
                <span className="lesson-volume-inline__value">{remoteVolume}%</span>
              </div>
              {hasGuitarTrack && (
                <div className="lesson-volume-inline">
                  <span className="lesson-volume-inline__icon" title={language === 'en' ? "Peer's Guitar Volume" : "相手のギター音量"}>🎸</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={remoteGuitarVolume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRemoteGuitarVolume(v);
                      remoteAudioPlayerRef.current?.setGuitarVolume?.(v);
                    }}
                    className="lesson-volume__slider"
                  />
                  <span className="lesson-volume-inline__value">{remoteGuitarVolume}%</span>
                </div>
              )}
              {audioInputMode === 'dual' && (
                <>
                  <div className="lesson-volume-inline">
                    <span className="lesson-volume-inline__icon" title="自分のマイク音量">🎤</span>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={voiceVolume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setVoiceVolume(v);
                        if (voiceGainRef.current && sharedContextRef.current) {
                          voiceGainRef.current.gain.setTargetAtTime(v / 100, sharedContextRef.current.currentTime, 0.01);
                        }
                      }}
                      className="lesson-volume__slider"
                    />
                    <span className="lesson-volume-inline__value">{voiceVolume}%</span>
                  </div>
                  <div className="lesson-volume-inline">
                    <span className="lesson-volume-inline__icon" title="自分のギター音量">🎸</span>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      value={guitarVolume}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setGuitarVolume(v);
                        if (guitarGainRef.current && sharedContextRef.current) {
                          guitarGainRef.current.gain.setTargetAtTime(v / 100, sharedContextRef.current.currentTime, 0.01);
                        }
                      }}
                      className="lesson-volume__slider"
                    />
                    <span className="lesson-volume-inline__value">{guitarVolume}%</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// added for debugging
