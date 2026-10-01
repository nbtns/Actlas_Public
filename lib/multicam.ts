/**
 * multicam.ts — マルチカメラ合成管理
 * 
 * 複数のカメラ映像をCanvas上に合成し、1本のMediaStreamとして出力する。
 * WebRTCのトラック差し替え（replaceTrack）で、再接続なしにマルチカメラ映像を送信できる。
 * 
 * 使い方:
 *   1. MultiCameraComposer を作成
 *   2. addCamera() で2台目のカメラを追加
 *   3. getComposedStream() で合成ストリームを取得
 *   4. WebRTCのsenderで replaceTrack(composedTrack) を実行
 */

/** レイアウトの種類 */
export type CameraLayout = 'pip' | 'side-by-side' | 'top-bottom';

/** カメラ情報 */
interface CameraSlot {
  stream: MediaStream;
  videoElement: HTMLVideoElement;
  deviceId: string;
  label: string;
  /** 外部から渡されたストリームかどうか（trueの場合、destroy時にトラックを停止しない） */
  isExternal: boolean;
}

/** マルチカメラ合成管理クラス */
export class MultiCameraComposer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cameras: CameraSlot[] = [];
  private composedStream: MediaStream | null = null;
  private animationId: number | null = null;
  private layout: CameraLayout = 'pip';
  private running = false;
  private destroyed = false;
  private frameCount = 0; // デバッグ用フレームカウンタ
  private lastDrawTime = 0;
  private readonly TARGET_FPS = 30;
  private readonly FRAME_INTERVAL = 1000 / 30;

  // Canvas解像度（WebRTC送信用）
  private readonly WIDTH = 1920;
  private readonly HEIGHT = 1080;

  // PiPモードのサブカメラサイズ（メイン映像に対する比率）
  private readonly PIP_SCALE = 0.28;
  private readonly PIP_MARGIN = 16;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.WIDTH;
    this.canvas.height = this.HEIGHT;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2Dコンテキストの取得に失敗しました');
    this.ctx = ctx;
  }

  /** 利用可能なカメラデバイスの一覧を取得 */
  static async getAvailableCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  }

  /** 現在のレイアウトを取得 */
  getLayout(): CameraLayout {
    return this.layout;
  }

  /** レイアウトを変更（描画ループは自動で反映） */
  setLayout(layout: CameraLayout): void {
    this.layout = layout;
  }

  /** カメラの台数を取得 */
  getCameraCount(): number {
    return this.cameras.length;
  }

  /** メインカメラ（1台目）を設定する — 通常はjoinCallで取得したストリームを渡す */
  async setMainCamera(stream: MediaStream, deviceId: string = 'default'): Promise<void> {
    // 既存のメインカメラがあれば差し替え
    if (this.cameras.length > 0) {
      this.cameras[0].stream = stream;
      this.cameras[0].videoElement.srcObject = stream;
      this.cameras[0].deviceId = deviceId;
      // 差し替え後もフレーム準備完了を待つ
      await this.waitForVideoReady(this.cameras[0].videoElement);
      return;
    }

    const videoEl = this.createVideoElement(stream);
    await this.waitForVideoReady(videoEl);
    this.cameras.push({
      stream,
      videoElement: videoEl,
      deviceId,
      label: 'メインカメラ',
      isExternal: true, // メインカメラは外部（LessonView）から渡されたもの → destroy時にトラックを停止しない
    });
  }

  /** 2台目のカメラを追加する */
  async addCamera(deviceId: string): Promise<void> {
    // 既に同じカメラが追加されている場合はスキップ
    if (this.cameras.some(c => c.deviceId === deviceId)) {
      console.warn('このカメラは既に追加されています。スキップします');
      return;
    }

    // 最大2台まで
    if (this.cameras.length >= 2) {
      // 既存の2台目を差し替え
      await this.removeSubCamera();
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (e) {
      console.warn('[MultiCam] サブカメラの高画質取得に失敗。HD(720p)フォールバック', e);
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
    }

    // デバイスラベルを取得
    const devices = await MultiCameraComposer.getAvailableCameras();
    const device = devices.find(d => d.deviceId === deviceId);
    const label = device?.label || `カメラ ${this.cameras.length + 1}`;

    const videoEl = this.createVideoElement(stream);
    await this.waitForVideoReady(videoEl);
    this.cameras.push({
      stream,
      videoElement: videoEl,
      deviceId,
      label,
      isExternal: false, // サブカメラはaddCamera内でgetUserMediaしたもの → destroy時にトラックを停止する
    });
  }

  /** 2台目のカメラを削除する */
  async removeSubCamera(): Promise<void> {
    if (this.cameras.length <= 1) return;
    const sub = this.cameras.pop();
    if (sub) {
      sub.stream.getTracks().forEach(t => t.stop());
      sub.videoElement.srcObject = null;
      sub.videoElement.remove();
    }
  }

  /** メインカメラとサブカメラを入れ替える */
  async swapCameras(): Promise<void> {
    if (this.cameras.length < 2) return;

    const tempStream = this.cameras[0].stream;
    const tempDeviceId = this.cameras[0].deviceId;
    const tempLabel = this.cameras[0].label;
    const tempIsExternal = this.cameras[0].isExternal;

    this.cameras[0].stream = this.cameras[1].stream;
    this.cameras[0].deviceId = this.cameras[1].deviceId;
    this.cameras[0].label = this.cameras[1].label;
    this.cameras[0].isExternal = this.cameras[1].isExternal;
    this.cameras[0].videoElement.srcObject = this.cameras[1].stream;

    this.cameras[1].stream = tempStream;
    this.cameras[1].deviceId = tempDeviceId;
    this.cameras[1].label = tempLabel;
    this.cameras[1].isExternal = tempIsExternal;
    this.cameras[1].videoElement.srcObject = tempStream;

    await this.waitForVideoReady(this.cameras[0].videoElement);
    await this.waitForVideoReady(this.cameras[1].videoElement);
  }

  /** Canvas合成を開始し、合成ストリームを返す */
  startComposing(): MediaStream {
    if (this.running) {
      return this.composedStream!;
    }

    this.running = true;
    this.frameCount = 0;
    this.lastDrawTime = performance.now();

    // 重要: captureStream を描画ループの「前」に取得する。
    // renderLoop() の最初の drawFrame() で描画された内容がキャプチャされるようにする。
    this.composedStream = this.canvas.captureStream(30);

    // Canvas描画ループを開始
    this.animationId = requestAnimationFrame(this.renderLoop);

    console.log('[MultiCam] ✅ Canvas合成開始 — captureStream取得済み, トラック:',
      this.composedStream.getVideoTracks()[0]?.readyState,
      'muted:', this.composedStream.getVideoTracks()[0]?.muted);

    return this.composedStream;
  }

  /** Canvas合成を停止する */
  stopComposing(): void {
    this.running = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /** 合成済みの映像トラックを取得（WebRTC replaceTrack用） */
  getComposedVideoTrack(): MediaStreamTrack | null {
    if (!this.composedStream) return null;
    const tracks = this.composedStream.getVideoTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  /** リソースを全て解放する */
  destroy(): void {
    this.destroyed = true;
    this.stopComposing();
    // composedStream（canvas.captureStream）のトラックを停止
    this.composedStream?.getTracks().forEach(t => t.stop());
    this.composedStream = null;
    // カメラのストリームとvideo要素を解放
    for (let i = 0; i < this.cameras.length; i++) {
      // 外部から渡されたストリーム（メインカメラ）のトラックは停止しない。
      // メインカメラのストリーム管理は呼び出し側（LessonView）の責任。
      // destroy()でメインのトラックも停止すると、エラー時のフォールバックで
      // シングルカメラに戻れなくなるバグが発生する。
      if (!this.cameras[i].isExternal) {
        this.cameras[i].stream.getTracks().forEach(t => t.stop());
      }
      this.cameras[i].videoElement.srcObject = null;
      this.cameras[i].videoElement.remove();
    }
    this.cameras = [];
  }

  /** マルチカメラが有効かどうか（2台以上のカメラがあるか） */
  isMultiCameraActive(): boolean {
    return this.cameras.length >= 2;
  }

  // --- private ---

  /**
   * 非表示のvideo要素を作成してストリームを再生する。
   * 
   * 重要な設計上の注意:
   * - Chromeはビューポート外（top:-9999px等）のvideo要素のフレームデコードを停止する
   *   （IntersectionObserverベースの最適化）。これによりCanvas描画が止まり、
   *   相手の通話画面がフリーズする。
   * - 対策: video要素をビューポート内（右下隅）に配置し、z-index:-1で他の要素の下に隠す。
   *   Chromeは「ビューポート内にある」と判断してフレームデコードを続ける。
   */
  private createVideoElement(stream: MediaStream): HTMLVideoElement {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true; // 音声はWebRTCの音声トラック経由で送る
    video.playsInline = true;
    // ビューポート内（右下隅）に配置し、z-index:-1で隠す。
    // Chromeの強力なオクルージョン・カリング（非表示時のデコード停止）を確実に防ぐため、
    // 2x2pxのサイズ、opacity:0.1、GPUアクセラレーション(translateZ)を付与する。
    video.setAttribute('style',
      'position:fixed;bottom:0;right:0;width:2px;height:2px;z-index:-1;opacity:0.1;pointer-events:none;transform:translateZ(0);will-change:transform;'
    );
    document.body.appendChild(video);
    video.play().catch((e) => {
      console.warn('[MultiCam] video.play() 失敗:', e);
    });
    return video;
  }

  /**
   * video要素がフレームを描画可能になるまで待つ。
   * 
   * readyState のポーリングとイベントリスナーの両方で監視する。
   * Chromeの最適化でイベントが発火しない場合もポーリングで検出できる。
   * 最大2秒でタイムアウト（タイムアウトしても続行する）。
   */
  private waitForVideoReady(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const timeoutId = window.setTimeout(() => {
        if (!resolved) {
          console.warn('[MultiCam] waitForVideoReady タイムアウト — readyState:',
            video.readyState, 'videoWidth:', video.videoWidth);
          done();
        }
      }, 2000);
      const done = () => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timeoutId);
        cancelAnimationFrame(pollId);
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('playing', done);
        console.log('[MultiCam] video準備完了 — readyState:', video.readyState,
          'videoWidth:', video.videoWidth, 'videoHeight:', video.videoHeight);
        resolve();
      };

      // すでにフレームが利用可能な場合は即座に解決
      if (video.readyState >= 2 && video.videoWidth > 0) {
        done();
        return;
      }

      // イベントリスナー（loadeddata と playing の両方で待つ）
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('playing', done, { once: true });

      // readyState のポーリング（イベントが発火しないケースへの安全策）
      let pollId: number = 0;
      const poll = () => {
        if (resolved) return;
        if (this.destroyed) {
          done();
          return;
        }
        if (video.readyState >= 2 && video.videoWidth > 0) {
          done();
          return;
        }
        pollId = requestAnimationFrame(poll);
      };
      pollId = requestAnimationFrame(poll);
    });
  }

  /** 描画ループ — try-catchで例外が発生してもループが停止しないようにする */
  private renderLoop = (timestamp: number): void => {
    if (!this.running) return;

    if (timestamp - this.lastDrawTime >= this.FRAME_INTERVAL) {
      // 経過時間から次の目標時間を計算（フレームスキップ時のズレを防ぐ）
      this.lastDrawTime = timestamp - (timestamp - this.lastDrawTime) % this.FRAME_INTERVAL;

      try {
        this.drawFrame();
      } catch (e) {
        // 描画エラーが発生してもループを停止しない
        if (this.frameCount < 5) {
          console.error('[MultiCam] 描画エラー:', e);
        }
      }

      this.frameCount++;
      // デバッグ: 最初の数フレームの状態をログ出力
      if (this.frameCount === 1 || this.frameCount === 10 || this.frameCount === 60) {
        const mainVideo = this.cameras[0]?.videoElement;
        const subVideo = this.cameras[1]?.videoElement;
        console.log('[MultiCam] フレーム#', this.frameCount, '— メイン:', mainVideo?.videoWidth, 'x', mainVideo?.videoHeight, 'readyState:', mainVideo?.readyState,
          subVideo ? `サブ: ${subVideo.videoWidth}x${subVideo.videoHeight} readyState:${subVideo.readyState}` : '(サブなし)');
      }
    }

    if (this.running && !this.destroyed) {
      this.animationId = requestAnimationFrame(this.renderLoop);
    }
  };

  /** 1フレーム描画 */
  private drawFrame(): void {
    const { ctx, WIDTH, HEIGHT } = this;

    // 背景をクリア（黒）
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (this.cameras.length === 0) return;

    const main = this.cameras[0].videoElement;

    // video要素がまだフレームをデコードしていない場合はスキップ
    // （黒背景が維持される。captureStreamは黒フレームをキャプチャするので止まらない）
    if (main.readyState < 2 || main.videoWidth === 0) return;

    if (this.cameras.length === 1) {
      // カメラ1台 → 全画面描画
      this.drawVideoContain(main, 0, 0, WIDTH, HEIGHT);
      return;
    }

    const sub = this.cameras[1].videoElement;

    switch (this.layout) {
      case 'pip':
        // メインカメラ: 全画面
        this.drawVideoContain(main, 0, 0, WIDTH, HEIGHT);
        // サブカメラ: 左下小窓（サブがまだ準備できていない場合はメインのみ描画）
        if (sub.readyState >= 2 && sub.videoWidth > 0) {
          const pipW = Math.round(WIDTH * this.PIP_SCALE);
          const pipH = Math.round(HEIGHT * this.PIP_SCALE);
          const pipX = this.PIP_MARGIN; // 左上に配置
          const pipY = this.PIP_MARGIN;

          // 小窓の背景（角丸効果のための枠）
          ctx.save();
          this.roundRect(ctx, pipX - 2, pipY - 2, pipW + 4, pipH + 4, 8);
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.fill();

          // 小窓の映像
          ctx.beginPath();
          this.roundRect(ctx, pipX, pipY, pipW, pipH, 6);
          ctx.clip();
          this.drawVideoContain(sub, pipX, pipY, pipW, pipH);
          ctx.restore();
        }
        break;

      case 'side-by-side':
        // 左右分割: 50:50
        {
          const halfW = WIDTH / 2;
          // 中央に細い区切り線
          this.drawVideoContain(main, 0, 0, halfW - 1, HEIGHT);
          if (sub.readyState >= 2 && sub.videoWidth > 0) {
            this.drawVideoContain(sub, halfW + 1, 0, halfW - 1, HEIGHT);
          }
          // 区切り線
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(halfW - 1, 0, 2, HEIGHT);
        }
        break;

      case 'top-bottom':
        // 上下分割: 50:50
        {
          const halfH = HEIGHT / 2;
          this.drawVideoContain(main, 0, 0, WIDTH, halfH - 1);
          if (sub.readyState >= 2 && sub.videoWidth > 0) {
            this.drawVideoContain(sub, 0, halfH + 1, WIDTH, halfH - 1);
          }
          // 区切り線
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(0, halfH - 1, WIDTH, 2);
        }
        break;
    }
  }

  /** video要素を指定領域にアスペクト比を保って収める（contain） */
  private drawVideoContain(
    video: HTMLVideoElement,
    dx: number, dy: number,
    dw: number, dh: number,
  ): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // videoWidthが0の場合は描画しない（例外防止）
    if (vw === 0 || vh === 0) return;

    const srcAspect = vw / vh;
    const dstAspect = dw / dh;

    let targetW = dw;
    let targetH = dh;
    if (srcAspect > dstAspect) {
      targetH = dw / srcAspect;
    } else {
      targetW = dh * srcAspect;
    }

    const targetX = dx + (dw - targetW) / 2;
    const targetY = dy + (dh - targetH) / 2;

    this.ctx.drawImage(video, 0, 0, vw, vh, targetX, targetY, targetW, targetH);
  }

  /** CanvasRenderingContext2Dに角丸パスを追加する */
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
