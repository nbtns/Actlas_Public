/**
 * translate.ts — OpenAI リアルタイム翻訳クライアント
 * 
 * WebRTC経由でOpenAIの gpt-realtime-translate モデルに接続し、
 * 相手の音声をリアルタイムで翻訳字幕として返す。
 * 
 * 仕組み:
 * 1. サーバーからエフェメラルトークン（使い捨てキー）を取得
 * 2. OpenAIのRealtime APIにWebRTC接続
 * 3. 相手の音声ストリームを入力 → 翻訳テキストがデータチャネルで返ってくる
 * 4. 翻訳済みテキストを字幕としてコールバックに通知
 * 
 * 長時間対応:
 * - セッションが切断された場合、自動で再接続する（最大リトライ回数あり）
 * - 45分経過でプロアクティブにセッションを更新（60分の上限に備える）
 * - 再接続中も「再接続中」状態を通知し、翻訳されない会話を最小化
 */

/** 翻訳セッションのイベント */
export interface TranslationCallbacks {
  /** 翻訳字幕のテキストが更新されたとき（ストリーミング中も含む） */
  onSubtitle: (text: string) => void;
  /** 1つの発話の翻訳が完了したとき（確定テキスト） */
  onTranscriptDone?: (text: string) => void;
  /** 翻訳セッションの状態が変わったとき */
  onStateChange: (state: TranslationState) => void;
  /** エラー発生時 */
  onError: (error: string) => void;
}

/** 翻訳の状態 */
export type TranslationState = 'idle' | 'connecting' | 'active' | 'reconnecting' | 'error' | 'disconnected';

class NonRetryableTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableTranslationError';
  }
}

/** プロアクティブ更新を開始するまでの時間（45分 = 2,700,000ms） */
const PROACTIVE_REFRESH_MS = 45 * 60 * 1000;

/** 自動再接続の最大リトライ回数 */
const MAX_AUTO_RECONNECT = 50;

/** 再接続時の最小待機時間（ms） */
const RECONNECT_BASE_DELAY_MS = 1000;

/** 再接続時の最大待機時間（ms） */
const RECONNECT_MAX_DELAY_MS = 5000;

/**
 * リアルタイム翻訳マネージャー
 * 
 * OpenAIの gpt-realtime-translate モデルをWebRTC経由で使用し、
 * 相手の音声をリアルタイムで翻訳する。
 * 接続が切れた場合は自動的に再接続し、長時間のレッスンでも翻訳を継続する。
 */
export class TranslationManager {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private callbacks: TranslationCallbacks;
  private state: TranslationState = 'idle';
  /** 現在構築中の字幕テキスト（画面表示用、5秒で消える） */
  private currentSubtitle: string = '';
  /** 字幕を自動的に消すタイマー */
  private subtitleTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- 長時間対応用のプロパティ ---
  /** 現在の入力ストリーム（再接続時に再利用） */
  private currentStream: MediaStream | null = null;
  /** 現在の翻訳先言語（再接続時に再利用） */
  private currentLanguage: string = 'ja';
  /** 現在の通話ルームID（サーバー側の通話参加チェックで使用） */
  private currentRoomId: string | null = null;
  /** 自動再接続の残り回数 */
  private reconnectAttemptsLeft: number = MAX_AUTO_RECONNECT;
  /** プロアクティブ更新タイマー */
  private proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** 手動停止フラグ（stop()を呼んだ場合は自動再接続しない） */
  private manuallyStopped: boolean = false;
  /** 再接続中フラグ（二重再接続を防止） */
  private isReconnecting: boolean = false;
  /** セッション開始時刻（プロアクティブ更新の判定に使用） */
  private sessionStartTime: number = 0;
  /** 接続の重複・競合を防ぐためのID */
  private currentConnectionId: number = 0;

  constructor(callbacks: TranslationCallbacks) {
    this.callbacks = callbacks;
  }

  /** 翻訳セッションを開始する */
  async start(remoteStream: MediaStream, targetLanguage: string = 'ja', roomId?: string): Promise<void> {
    this.currentConnectionId++; // 新しい接続IDを発行
    // ストリームと言語を保存（再接続時に使用）
    this.currentStream = remoteStream;
    this.currentLanguage = targetLanguage;
    this.currentRoomId = roomId || null;
    this.manuallyStopped = false;
    this.reconnectAttemptsLeft = MAX_AUTO_RECONNECT;

    await this.connectSession();
  }

  /**
   * 内部: 実際にOpenAIとのWebRTCセッションを確立する
   * start() と再接続の両方から呼ばれる
   */
  private async connectSession(): Promise<void> {
    if (!this.currentStream) return;
    const connectionId = this.currentConnectionId;

    try {
      // 再接続の場合は 'reconnecting'、初回は 'connecting'
      const isReconnect = this.state === 'reconnecting' || this.state === 'disconnected' || this.state === 'error';
      if (!isReconnect) {
        this.updateState('connecting');
      }

      // ① サーバーからエフェメラルトークンを取得
      const tokenRes = await fetch('/api/translate-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetLanguage: this.currentLanguage,
          roomId: this.currentRoomId,
        }),
      });

      // フェッチ中にstop()や新しいstart()が呼ばれたら中断
      if (this.manuallyStopped || this.currentConnectionId !== connectionId) return;

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        // エラーの詳細を表示してデバッグしやすくする
        let errorMsg = errorData.error || 'トークンの取得に失敗しました';
        if (errorData.details) {
          try {
            const details = JSON.parse(errorData.details);
            errorMsg += ` (${details.error?.message || details.error?.code || errorData.details})`;
          } catch {
            errorMsg += ` (${errorData.details.substring(0, 100)})`;
          }
        }
        if (tokenRes.status >= 400 && tokenRes.status < 500) {
          throw new NonRetryableTranslationError(errorMsg);
        }
        throw new Error(errorMsg);
      }

      const tokenData = await tokenRes.json();
      // 翻訳APIはトップレベルにvalueを返す（通常のRealtimeAPIはclient_secret.value）
      const ephemeralKey = tokenData.value || tokenData.client_secret?.value;

      if (!ephemeralKey) {
        throw new Error('エフェメラルトークンが取得できませんでした (レスポンス: ' + JSON.stringify(tokenData).substring(0, 100) + ')');
      }

      // 古い接続があれば先にクリーンアップ（再接続時）
      this.cleanupConnection();

      // ② WebRTC PeerConnectionを作成
      this.pc = new RTCPeerConnection();

      // ③ 相手の音声トラックを入力として追加
      const audioTracks = this.currentStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('相手の音声トラックが見つかりません');
      }
      this.pc.addTrack(audioTracks[0], this.currentStream);

      // ④ データチャネルを作成（翻訳テキストを受信する）
      this.dataChannel = this.pc.createDataChannel('oai-events');
      this.dataChannel.onmessage = (event) => {
        this.handleTranslationEvent(event.data);
      };
      this.dataChannel.onopen = () => {
        // 接続直後に翻訳先言語を設定
        this.dataChannel?.send(JSON.stringify({
          type: 'session.update',
          session: {
            audio: {
              output: {
                language: this.currentLanguage,
              },
            },
          },
        }));
      };
      this.dataChannel.onclose = () => {};

      // ⑤ SDP交渉（OpenAIのRealtime APIに接続）
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      const sdpResponse = await fetch(
        'https://api.openai.com/v1/realtime/translations/calls',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      );

      // フェッチ中に中断された場合はここでリターン
      if (this.manuallyStopped || this.currentConnectionId !== connectionId) return;

      if (!sdpResponse.ok) {
        throw new Error(`OpenAI接続に失敗: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      // アンサー適用前にもチェック
      if (this.manuallyStopped || this.currentConnectionId !== connectionId) return;

      await this.pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      // 接続状態を監視（切断時の自動再接続を含む）
      this.pc.onconnectionstatechange = () => {
        const connState = this.pc?.connectionState;
        switch (connState) {
          case 'connected':
            this.isReconnecting = false;
            this.updateState('active');
            // セッション開始時刻を記録
            this.sessionStartTime = Date.now();
            // プロアクティブ更新タイマーを設定（45分後に自動でセッション更新）
            this.scheduleProactiveRefresh();
            break;
          case 'disconnected':
          case 'failed':
          case 'closed':
            // 手動停止でなければ自動再接続を試みる
            if (!this.manuallyStopped) {
              this.handleAutoReconnect();
            } else {
              this.updateState('disconnected');
            }
            break;
        }
      };

      this.updateState('active');
    } catch (error) {
      const message = error instanceof Error ? error.message : '翻訳の開始に失敗しました';
      
      if (error instanceof NonRetryableTranslationError) {
        this.updateState('error');
        this.callbacks.onError(message);
        return;
      }

      // 手動停止でなければ自動再接続を試みる
      if (!this.manuallyStopped) {
        console.warn('翻訳接続エラー、自動再接続を試みます:', message);
        this.handleAutoReconnect();
      } else {
        this.updateState('error');
        this.callbacks.onError(message);
      }
    }
  }

  /**
   * 自動再接続を処理する
   * 接続が切れた場合にバックオフ付きで再接続を試みる
   */
  private handleAutoReconnect(): void {
    // 手動停止中、または既に再接続処理中なら何もしない
    if (this.manuallyStopped || this.isReconnecting) return;

    // リトライ回数チェック
    if (this.reconnectAttemptsLeft <= 0) {
      console.error('自動再接続の最大回数に達しました');
      this.updateState('error');
      this.callbacks.onError('翻訳の自動再接続に失敗しました。「Retry」ボタンで手動再接続してください。');
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttemptsLeft--;
    this.updateState('reconnecting');

    // バックオフ計算（1秒〜5秒のランダム遅延）
    const attempt = MAX_AUTO_RECONNECT - this.reconnectAttemptsLeft;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(1.5, attempt - 1),
      RECONNECT_MAX_DELAY_MS
    );
    // ジッター追加（0〜500msのランダム）
    const jitter = Math.random() * 500;
    const totalDelay = delay + jitter;

    console.log(`🔄 翻訳再接続を試みます (${attempt}/${MAX_AUTO_RECONNECT}) ${Math.round(totalDelay)}ms後...`);

    setTimeout(async () => {
      if (this.manuallyStopped) {
        this.isReconnecting = false;
        return;
      }

      try {
        await this.connectSession();
        if (this.getState() === 'error') {
          this.isReconnecting = false;
          return;
        }
        // 成功したらリトライカウントをリセット
        this.reconnectAttemptsLeft = MAX_AUTO_RECONNECT;
        console.log('✅ 翻訳再接続成功');
      } catch (err) {
        console.error('翻訳再接続失敗:', err);
        this.isReconnecting = false;
        // 次のリトライを試みる
        this.handleAutoReconnect();
      }
    }, totalDelay);
  }

  /**
   * 45分後にセッションをプロアクティブに更新する
   * OpenAIの60分上限に達する前に、新しいセッションにシームレスに切り替える
   */
  private scheduleProactiveRefresh(): void {
    // 既存のタイマーをクリア
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
    }

    this.proactiveRefreshTimer = setTimeout(async () => {
      if (this.manuallyStopped || this.state !== 'active') return;

      console.log('🔄 プロアクティブセッション更新を開始（45分経過）');
      
      // 古い接続をクリーンアップして新しいセッションを開始
      this.cleanupConnection();
      
      try {
        await this.connectSession();
        if (this.getState() === 'error') return;
        console.log('✅ プロアクティブセッション更新成功');
      } catch (err) {
        console.error('プロアクティブ更新失敗、自動再接続に移行:', err);
        // 失敗した場合は通常の再接続ロジックに任せる
      }
    }, PROACTIVE_REFRESH_MS);
  }

  /** OpenAIから届く翻訳イベントを処理 */
  private handleTranslationEvent(data: string): void {
    try {
      const event = JSON.parse(data);

      switch (event.type) {
        // 翻訳テキストの断片が届いた（ストリーミング）
        case 'session.output_transcript.delta':
          this.currentSubtitle += event.delta || '';
          this.callbacks.onSubtitle(this.currentSubtitle);
          this.resetSubtitleTimeout();
          break;

        // 1つの発話の翻訳が完了
        case 'session.output_transcript.done':
          if (event.transcript) {
            const transcript = event.transcript.trim();
            if (transcript) {
              this.currentSubtitle = transcript;
              this.callbacks.onSubtitle(this.currentSubtitle);
              this.callbacks.onTranscriptDone?.(transcript);
            }
          }
          // 完了後、次の発話に備えて字幕をリセット（ログはそのまま蓄積）
          this.currentSubtitle = '';
          this.resetSubtitleTimeout();
          break;

        // セッションエラー
        case 'error':
          console.error('翻訳エラー:', event);
          // セッションエラーでも自動再接続を試みる
          if (!this.manuallyStopped) {
            this.handleAutoReconnect();
          } else {
            this.callbacks.onError(event.message || '翻訳エラーが発生しました');
          }
          break;
      }
    } catch (e) {
      console.warn('翻訳イベントの解析に失敗:', e);
    }
  }

  /** 字幕の自動クリアタイマーをリセット */
  private resetSubtitleTimeout(): void {
    if (this.subtitleTimeout) {
      clearTimeout(this.subtitleTimeout);
    }
    // 発話が終わって5秒後に字幕をクリア（ログは消さない）
    this.subtitleTimeout = setTimeout(() => {
      this.currentSubtitle = '';
      this.callbacks.onSubtitle('');
    }, 5000);
  }

  /** 状態を更新してコールバックに通知 */
  private updateState(state: TranslationState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  /** 現在の翻訳状態を取得 */
  getState(): TranslationState {
    return this.state;
  }

  /**
   * WebRTC接続だけをクリーンアップする（再接続用）
   * ログ蓄積やタイマーは保持する
   */
  private cleanupConnection(): void {
    if (this.dataChannel) {
      this.dataChannel.onmessage = null;
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      try { this.dataChannel.close(); } catch { /* 無視 */ }
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      try { this.pc.close(); } catch { /* 無視 */ }
      this.pc = null;
    }
  }

  /** 翻訳セッションを停止してリソースを解放 */
  stop(): void {
    // 進行中の非同期処理を安全に中断させるためIDを更新
    this.currentConnectionId++;

    // 手動停止フラグを立てる（自動再接続を防止）
    this.manuallyStopped = true;
    this.isReconnecting = false;

    // プロアクティブ更新タイマーを停止
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
      this.proactiveRefreshTimer = null;
    }

    if (this.subtitleTimeout) {
      clearTimeout(this.subtitleTimeout);
    }

    // WebRTC接続をクリーンアップ
    this.cleanupConnection();

    this.currentSubtitle = '';
    this.currentStream = null;
    this.currentRoomId = null;
    this.updateState('idle');
  }
}
