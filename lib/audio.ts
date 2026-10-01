/**
 * audio.ts — ギター音質特化の音声設定
 * 
 * ブラウザ標準のノイズキャンセル等をすべて無効にし、
 * ギターの生音に近い高音質で通信するための設定を管理する。
 */

/**
 * ギター最適化されたメディア制約
 * - エコーキャンセル、ノイズ抑制、自動ゲイン → すべて無効
 * - ステレオ、48kHz、16bit → 高音質設定
 */
export function getMediaConstraints(): MediaStreamConstraints {
  return {
    audio: {
      // ブラウザの音声処理をすべて無効化（ギターの音を潰さない）
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // 高音質設定
      channelCount: { ideal: 2 },        // ステレオ
      sampleRate: { ideal: 48000 },       // 48kHz サンプリングレート
      sampleSize: { ideal: 16 },          // 16bit
    } as MediaTrackConstraints,
    video: {
      // 映像設定（4K・フルHD高画質対応）
      width: { ideal: 3840, max: 3840 },
      height: { ideal: 2160, max: 2160 },
      frameRate: { ideal: 30, max: 60 },
      facingMode: 'user',  // フロントカメラ優先
    },
  };
}

/**
 * 共有AudioContextを作成する
 * 
 * getUserMediaでマイクを取得した「後」に呼ぶこと！
 * （Safariでは、マイク取得前にAudioContextを作るとマイクが動かなくなる）
 * 
 * 無音出力も同時に開始して、macOSのオーディオルーティングを
 * 入出力同時使用モードで初期化する。
 */
const AUDIO_CONTEXT_OPTIONS: AudioContextOptions = {
  sampleRate: 48000,
};

export async function createSharedAudioContext(): Promise<AudioContext> {
  const context = new AudioContext(AUDIO_CONTEXT_OPTIONS);

  // AudioContextがsuspendedなら明示的に再開（Safari対策）
  if (context.state === 'suspended') {
    await context.resume();
  }
  
  // 無音のオシレーターを再生 → macOSに「音声出力も使うよ」と通知
  // これにより、後から相手の音声が到着しても、オーディオルーティングの再構成が発生しない
  const oscillator = context.createOscillator();
  const silentGain = context.createGain();
  silentGain.gain.value = 0; // 完全に無音
  oscillator.connect(silentGain);
  silentGain.connect(context.destination);
  oscillator.start();

  // ★ メモリリーク対策：AudioContextがcloseされたときに、オシレーター等のノードも完全に解放する
  const originalClose = context.close.bind(context);
  context.close = async () => {
    try {
      oscillator.stop();
    } catch (_e) {
      // すでに停止している場合のエラーは無視
    }
    oscillator.disconnect();
    silentGain.disconnect();
    return originalClose();
  };

  return context;
}

/**
 * SDP（接続プロトコル）を書き換えて、Opusコーデックの音質を最大化する
 * 
 * 通常のWebRTC通話は「声」に最適化されているため、
 * ギター向けに高ビットレート＆ステレオに変更する。
 */
export function enhanceSdpForMusic(sdp: string): string {
  // Opusコーデックの設定行を探して、音楽向けのパラメータを追加
  const lines = sdp.split('\r\n');
  const enhancedLines = lines.map((line) => {
    // a=fmtp:{opusのペイロード番号} の行を見つける
    if (line.startsWith('a=fmtp:') && line.includes('minptime')) {
      // 既存のパラメータに音楽向け設定を追加
      let enhanced = line;
      
      // ステレオ有効化
      if (!enhanced.includes('stereo=')) {
        enhanced += ';stereo=1';
      }
      // ステレオ送信を宣言
      if (!enhanced.includes('sprop-stereo=')) {
        enhanced += ';sprop-stereo=1';
      }
      // 最大ビットレートを128kbpsに設定（デフォルトは32kbps程度）
      if (!enhanced.includes('maxaveragebitrate=')) {
        enhanced += ';maxaveragebitrate=128000';
      }
      // 48kHz帯域まで使う（声だけでなくギターの高域も残す）
      if (!enhanced.includes('maxplaybackrate=')) {
        enhanced += ';maxplaybackrate=48000';
      }
      // 音楽では無音区間判定で音の立ち上がりが削れることがあるため無効化
      if (!enhanced.includes('usedtx=')) {
        enhanced += ';usedtx=0';
      }
      // CBR（固定ビットレート）で安定した音質を確保
      if (!enhanced.includes('cbr=')) {
        enhanced += ';cbr=1';
      }
      
      return enhanced;
    }
    return line;
  });

  return enhancedLines.join('\r\n');
}

/**
 * 音声レベルを監視するためのアナライザーを作成
 * メーター表示に使用する
 * 
 * @param stream - 監視対象のMediaStream
 * @param sharedContext - 共有AudioContext（指定しない場合は新規作成）
 */
export function createAudioAnalyser(stream: MediaStream, sharedContext?: AudioContext): {
  analyser: AnalyserNode;
  context: AudioContext;
  getLevel: () => number;
  /** AudioNodeの接続を切断してストリーム参照を解放する */
  disconnect: () => void;
} {
  // 共有コンテキストがあればそれを使う（AudioContext干渉防止）
  const context = sharedContext || new AudioContext(AUDIO_CONTEXT_OPTIONS);
  
  // ブラウザのセキュリティポリシーでAudioContextが一時停止している場合があるため、
  // 明示的に再開する（これをしないと音声レベルが0のまま動かない）
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);
  
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  
  // 現在の音声レベルを0〜100の数値で返す
  // AudioContextが停止中のときは再開を試みる
  const getLevel = (): number => {
    if (context.state === 'suspended') {
      context.resume().catch(() => {});
      return 0;
    }
    analyser.getByteFrequencyData(dataArray);
    const sum = dataArray.reduce((acc, val) => acc + val, 0);
    const average = sum / dataArray.length;
    return Math.min(100, Math.round((average / 255) * 100 * 2));
  };

  return {
    analyser,
    context,
    getLevel,
    disconnect: () => {
      source.disconnect();
      analyser.disconnect();
      // 内部で新規作成したAudioContextなら、クローズして解放する
      if (!sharedContext) {
        context.close().catch(() => {});
      }
    },
  };
}

/**
 * 現在適用されている音声設定を取得して表示用に返す
 */
export function getAudioSettingsInfo(track: MediaStreamTrack): Record<string, string> {
  const settings = track.getSettings();
  return {
    'エコーキャンセル': settings.echoCancellation ? '有効 ⚠️' : '無効 ✅',
    'ノイズ抑制': settings.noiseSuppression ? '有効 ⚠️' : '無効 ✅',
    '自動ゲイン': settings.autoGainControl ? '有効 ⚠️' : '無効 ✅',
    'サンプルレート': `${settings.sampleRate || '不明'}Hz`,
    'チャンネル数': settings.channelCount === 2 ? 'ステレオ ✅' : 'モノラル',
  };
}

/**
 * 相手の音声をWeb Audio API経由で再生するプレイヤーを作成
 * HTMLVideoElementから音声を出力するとmacOSのルーティング仕様でマイクが死ぬ問題の対策
 * 
 * @param stream - 相手の音声を含むMediaStream
 * @param autoPlay - trueなら作成時に即再生開始
 * @param sharedContext - 共有AudioContext（指定しない場合は新規作成）
 */
export function createRemoteAudioPlayer(stream: MediaStream, autoPlay = false, sharedContext?: AudioContext, hasGuitarTrack = false): {
  play: () => void;
  stop: () => void;
  setVolume: (percent: number) => void;
  setGuitarVolume: (percent: number) => void;
  setHasGuitarTrack: (enabled: boolean) => void;
  hasGuitarTrack: boolean;
  context: AudioContext;
  gainNode: GainNode;
  guitarGainNode?: GainNode;
} {
  // ★ 隠しaudio要素でブラウザの音声パイプラインを起動
  const audioEl = document.createElement('audio');
  audioEl.srcObject = stream;
  audioEl.volume = 0; // audio要素からは音を出さない（gainNodeで制御）
  audioEl.autoplay = true;
  audioEl.setAttribute('style', 'position:absolute;width:0;height:0;opacity:0;pointer-events:none');
  document.body.appendChild(audioEl);

  if (autoPlay) {
    audioEl.play().catch(() => {});
  }

  // Web Audio APIでゲイン制御
  const context = sharedContext || new AudioContext(AUDIO_CONTEXT_OPTIONS);
  
  // マイク単一は全チャンネルをそのまま、デュアル入力だけL/R分離で再生する
  const source = context.createMediaStreamSource(stream);
  const directGainNode = context.createGain();
  const splitter = context.createChannelSplitter(2);
  source.connect(directGainNode);
  directGainNode.connect(context.destination);
  source.connect(splitter);

  // マイク用ノード (Lチャンネル)
  const gainNode = context.createGain();
  splitter.connect(gainNode, 0); // L -> gainNode
  gainNode.connect(context.destination);
  
  // ギター用ノード (Rチャンネル)
  const guitarGainNode = context.createGain();
  splitter.connect(guitarGainNode, 1); // R -> guitarGainNode
  guitarGainNode.connect(context.destination);

  // 現在のユーザー設定音量
  let currentVolume = autoPlay ? 100 : 0;
  
  let currentGuitarVolume = autoPlay && hasGuitarTrack ? 50 : 0; // ギターはデフォルト50%
  let hasSeparateGuitarTrack = hasGuitarTrack;
  const applyOutputGains = () => {
    directGainNode.gain.value = hasSeparateGuitarTrack ? 0 : currentVolume / 100;
    gainNode.gain.value = hasSeparateGuitarTrack ? currentVolume / 100 : 0;
    guitarGainNode.gain.value = hasSeparateGuitarTrack ? currentGuitarVolume / 100 : 0;
  };
  applyOutputGains();

  // AudioContextがsuspendedなら再開を試みる
  if (autoPlay && context.state === 'suspended') {
    context.resume().catch(() => {});
  }

  return {
    play: () => {
      if (context.state === 'suspended') {
        context.resume().catch(() => {});
      }
      audioEl.play().catch(() => {});
      // ユーザーが音量0に設定していた場合はデフォルトに戻す
      if (currentVolume === 0) currentVolume = 100;
      if (hasSeparateGuitarTrack && currentGuitarVolume === 0) currentGuitarVolume = 50;
      
      applyOutputGains();
    },
    stop: () => {
      directGainNode.gain.value = 0;
      gainNode.gain.value = 0;
      guitarGainNode.gain.value = 0;
      
      source.disconnect();
      directGainNode.disconnect();
      splitter.disconnect();
      gainNode.disconnect();
      guitarGainNode.disconnect();
      
      audioEl.pause();
      audioEl.srcObject = null;
      audioEl.remove();

      // 内部で新規作成したAudioContextなら、クローズして解放する
      if (!sharedContext) {
        context.close().catch(() => {});
      }
    },
    setVolume: (percent: number) => {
      currentVolume = percent;
      applyOutputGains();
    },
    setGuitarVolume: (percent: number) => {
      currentGuitarVolume = percent;
      applyOutputGains();
    },
    setHasGuitarTrack: (enabled: boolean) => {
      hasSeparateGuitarTrack = enabled;
      if (enabled && currentGuitarVolume === 0) currentGuitarVolume = 50;
      applyOutputGains();
    },
    hasGuitarTrack, // 相手がデュアル入力のときだけUI側でギター音量を表示する
    context,
    gainNode,
    guitarGainNode,
  };
}

// ============================
// デュアルオーディオ入力（マイク＋ライン入力）
// ============================

/** オーディオ入力デバイスの型定義 */
export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

type AudioCaptureConstraints = MediaTrackConstraints & {
  latency?: ConstrainDouble;
  googEchoCancellation?: boolean;
  googAutoGainControl?: boolean;
  googNoiseSuppression?: boolean;
  googHighpassFilter?: boolean;
  googTypingNoiseDetection?: boolean;
};

/**
 * 利用可能なオーディオ入力デバイスの一覧を取得する
 * 
 * ブラウザは最初のgetUserMedia許可後でないとデバイスのラベル（名前）を返さないため、
 * この関数を呼ぶ前に一度マイクアクセスを許可しておくこと。
 */
export async function enumerateAudioDevices(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(d => d.kind === 'audioinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      // ラベルが空の場合はフォールバック名を付ける
      label: d.label || `マイク ${i + 1}`,
    }));
}

/**
 * マイクのみ通話のメディア制約を生成する
 * MacBook系の内蔵マイクではブラウザ補正が遅延やこもり音の原因になりやすいため、
 * ギターモードでは固定音質指定を避け、素の音に近い設定を優先する。
 */
export function getMicOnlyConstraints(deviceId: string | undefined, preferVoiceProcessing: boolean): MediaStreamConstraints {
  const audio: AudioCaptureConstraints = preferVoiceProcessing
    ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    : {
        echoCancellation: { exact: false },
        noiseSuppression: { exact: false },
        autoGainControl: { exact: false },
        googEchoCancellation: false,
        googAutoGainControl: false,
        googNoiseSuppression: false,
        googHighpassFilter: false,
        googTypingNoiseDetection: false,
      };

  if (deviceId) audio.deviceId = { exact: deviceId };

  return {
    audio,
    video: false,
  };
}

/**
 * 声専用マイクのメディア制約を生成する
 * デュアル入力ではギターはライン入力で別に拾うため、声用マイクだけノイズ抑制を有効にする
 * 
 * @param deviceId - 使用するマイクのデバイスID
 */
export function getVoiceOnlyConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: { exact: deviceId },
      // 声用マイクはノイズ抑制だけを有効にし、音量補正や固定音質指定はブラウザに任せる
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    } as AudioCaptureConstraints,
    video: false, // 映像は別で取得する
  };
}

/**
 * ギターライン入力のメディア制約を生成する
 * ノイズキャンセル等をすべて無効にして、ギターの生音をそのまま通す設定
 * 
 * @param deviceId - 使用するオーディオインターフェイスのデバイスID
 */
export function getGuitarLineConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: { exact: deviceId },
      // ギターの音を潰さないために全て無効化
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // 高音質設定
      channelCount: { ideal: 2 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
    } as MediaTrackConstraints,
    video: false, // 映像は別で取得する
  };
}

/**
 * 2つの音声ストリームを1つに合成する
 * 
 * マイク（声）とオーディオI/F（ギター）の2ストリームを
 * Web Audio APIのChannelMergerNodeでミックスし、
 * 1つのMediaStreamとしてWebRTCに送れるようにする。
 * 
 * @param voiceStream - 声専用マイクのストリーム
 * @param guitarStream - ギターライン入力のストリーム
 * @param sharedContext - 共有AudioContext
 * @returns 合成されたMediaStream と各ノードへの参照
 */
export function createDualAudioStream(
  voiceStream: MediaStream,
  guitarStream: MediaStream,
  sharedContext: AudioContext,
): {
  voiceOnlyStream: MediaStream;
  guitarEffectStream: MediaStream;
  voiceGain: GainNode;
  guitarGain: GainNode;
  guitarOutput: GainNode;
  disconnect: () => void;
} {
  // 各ストリームからAudioContextのソースノードを作成
  const voiceSource = sharedContext.createMediaStreamSource(voiceStream);
  const guitarSource = sharedContext.createMediaStreamSource(guitarStream);

  // 個別の音量コントロール用GainNode
  const voiceGain = sharedContext.createGain();
  const guitarGain = sharedContext.createGain();
  voiceGain.gain.value = 1.0;
  guitarGain.gain.value = 0.5;

  // ギターのエフェクトチェーン挿入ポイント
  const guitarOutput = sharedContext.createGain();
  guitarOutput.gain.value = 1.0;

  // 出力先の分離ノード
  // AI翻訳用（声のみ）
  const voiceDest = sharedContext.createMediaStreamDestination();
  // WebRTC配信用（ステレオL/R合成）
  const stereoDest = sharedContext.createMediaStreamDestination();
  stereoDest.channelCount = 2; // ステレオ出力

  // ChannelMergerNodeでL/Rに分ける
  const merger = sharedContext.createChannelMerger(2);

  // 声はAI翻訳用とWebRTCのLチャンネル（0）へ
  voiceSource.connect(voiceGain);
  voiceGain.connect(voiceDest);
  voiceGain.connect(merger, 0, 0);

  // ギターはギターエフェクト後、WebRTCのRチャンネル（1）へ
  guitarSource.connect(guitarGain);
  guitarGain.connect(guitarOutput);
  guitarOutput.connect(merger, 0, 1);

  // 合成されたステレオ音声を stereoDest に流す
  merger.connect(stereoDest);

  return {
    voiceOnlyStream: voiceDest.stream,
    guitarEffectStream: stereoDest.stream, // 変数名は既存と合わせるが、中身はマイク+ギターのステレオ
    voiceGain,
    guitarGain,
    guitarOutput,
    /** 全AudioNodeの接続を切断してストリーム参照を解放する */
    disconnect: () => {
      voiceSource.disconnect();
      guitarSource.disconnect();
      voiceGain.disconnect();
      guitarGain.disconnect();
      guitarOutput.disconnect();
      merger.disconnect();
      voiceDest.disconnect();
      stereoDest.disconnect();
    },
  };
}
