/**
 * webrtc.ts — WebRTC P2P接続の管理
 * 
 * ブラウザ同士の直接通信（映像＋音声）を管理する。
 * シグナリング（接続の仲介）はSocket.IO経由で行う。
 */
import { enhanceSdpForMusic } from './audio';

/** WebRTC接続の状態 */
export type ConnectionState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'disconnected';

/** ICEサーバー設定（NAT越えに必要） */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

const enhanceLocalDescriptionForMusic = (
  description: RTCSessionDescriptionInit,
): RTCSessionDescriptionInit => {
  if (!description.sdp) return description;
  return {
    ...description,
    sdp: enhanceSdpForMusic(description.sdp),
  };
};

/** WebRTC接続で発生するイベントの型定義 */
export interface WebRTCCallbacks {
  onStateChange: (state: ConnectionState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onError: (error: string) => void;
}

/**
 * WebRTC接続マネージャー
 * 1対1の映像＋音声通話を管理する
 */
export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private callbacks: WebRTCCallbacks;
  private state: ConnectionState = 'idle';
  // ontrack で streams が空の場合に手動でストリームを構築するためのバッファ
  private remoteStream: MediaStream | null = null;

  constructor(callbacks: WebRTCCallbacks) {
    this.callbacks = callbacks;
  }

  /** PeerConnectionを作成して初期化 */
  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      // 音質優先の設定
      bundlePolicy: 'max-bundle',
    });

    // 相手からの映像＋音声ストリームが届いたとき
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        // 通常ケース：streams[0] に映像＋音声ストリームが含まれる
        this.remoteStream = event.streams[0];
        this.callbacks.onRemoteStream(event.streams[0]);
      } else {
        // フォールバック：Firefox/Safari 等で streams が空配列になる場合
        // トラックを手動でストリームに追加して返す
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
        this.callbacks.onRemoteStream(this.remoteStream);
      }
    };

    // ICE候補（接続経路の情報）が見つかったとき → シグナリングサーバー経由で相手に送る
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate(event.candidate);
      }
    };

    // 接続状態が変わったとき
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connecting':
          this.updateState('connecting');
          break;
        case 'connected':
          this.updateState('connected');
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          this.updateState('disconnected');
          break;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        this.callbacks.onError('接続に失敗しました。このネットワークでは直接通話できない可能性があります。別の回線に切り替えるか、時間をおいて再接続してください。');
      }
    };

    this.pc = pc;
    return pc;
  }

  /** 状態を更新してコールバックを呼ぶ */
  private updateState(state: ConnectionState) {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  /** 現在の接続状態を取得 */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * ルームを作成する側（先生）の処理
   * 1. PeerConnectionを作成
   * 2. 自分の映像＋音声を追加
   * 3. Offerを作成して返す（これを相手に送る）
   */
  async createOffer(localStream: MediaStream): Promise<RTCSessionDescriptionInit> {
    const pc = this.createPeerConnection();
    
    // 自分の映像＋音声トラックを追加
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    this.updateState('waiting');

    // Offer（接続要求）を作成
    const offer = enhanceLocalDescriptionForMusic(await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    }));

    await pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * ルームに参加する側（生徒）の処理
   * 1. PeerConnectionを作成
   * 2. 自分の映像＋音声を追加
   * 3. 相手のOfferを受け取り、Answerを作成して返す
   */
  async createAnswer(
    localStream: MediaStream,
    remoteOffer: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    const pc = this.createPeerConnection();
    
    // 自分の映像＋音声トラックを追加
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    this.updateState('connecting');

    // 相手のOfferを設定
    await pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));

    // Answer（応答）を作成
    const answer = enhanceLocalDescriptionForMusic(await pc.createAnswer());

    await pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * 既存のPeerConnectionを使って再ネゴシエーション（トラック構成変更など）のOfferに応答する
   */
  async renegotiateAnswer(remoteOffer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('PeerConnectionが初期化されていません');
    
    await this.pc.setRemoteDescription(new RTCSessionDescription(remoteOffer));
    const answer = enhanceLocalDescriptionForMusic(await this.pc.createAnswer());
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * 相手からのAnswerを受け取る（ルーム作成者側）
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) throw new Error('PeerConnectionが初期化されていません');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * ICE候補（接続経路の情報）を追加する
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) throw new Error('PeerConnectionが初期化されていません');
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  /**
   * 映像トラックを差し替える（再接続なし）
   * マルチカメラ合成映像への切り替えに使用する
   */
  async replaceVideoTrack(newTrack: MediaStreamTrack): Promise<void> {
    if (!this.pc) return; // 通話前（PC未初期化）なら何もしない
    const senders = this.pc.getSenders();
    const videoSender = senders.find(s => s.track?.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(newTrack);
    }
  }

  /**
   * 音声トラックを差し替える（再接続なし）
   */
  async replaceAudioTrack(newTrack: MediaStreamTrack): Promise<void> {
    if (!this.pc) return; // 通話前（PC未初期化）なら何もしない
    const senders = this.pc.getSenders();
    const audioSender = senders.find(s => s.track?.kind === 'audio');
    if (audioSender) {
      await audioSender.replaceTrack(newTrack);
    }
  }

  /**
   * トラック構成を変更し、再ネゴシエーションのためのOfferを作成する
   */
  async renegotiate(stream: MediaStream): Promise<RTCSessionDescriptionInit> {
    if (!this.pc) throw new Error('PeerConnectionが初期化されていません');
    
    // 既存のすべてのSenderを削除
    const senders = this.pc.getSenders();
    senders.forEach(sender => this.pc!.removeTrack(sender));

    // 新しいストリームの全トラックを追加
    stream.getTracks().forEach(track => {
      this.pc!.addTrack(track, stream);
    });

    // 新しいOfferを作成
    const offer = enhanceLocalDescriptionForMusic(await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    }));
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * 通話を終了してリソースを解放
   */
  close(): void {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteStream = null;
    this.updateState('idle');
  }
}
