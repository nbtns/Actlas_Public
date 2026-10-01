'use client';

import React, { useState, useEffect, useRef } from 'react';
import YouTube, { YouTubeProps, YouTubePlayer } from 'react-youtube';
import { getSocket } from '@/lib/socket';
import { Video as IconVideo, Search as IconSearch } from 'lucide-react';

interface YouTubePlayerProps {
  language?: string;
  isCallActive?: boolean;
}

export default function YouTubePlayer({ language = 'ja', isCallActive = false }: YouTubePlayerProps) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const playerRef = useRef<YouTubePlayer | null>(null);
  const isRemoteOperation = useRef(false);

  // YouTubeのURLからVideo IDを抽出
  const extractVideoId = (url: string) => {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&?]+)/);
    return match ? match[1] : null;
  };

  const handleLoadVideo = () => {
    const id = extractVideoId(inputUrl) || inputUrl; // URLから抽出、できなければそのままIDとして扱う
    if (id && id.length >= 10) {
      setVideoId(id);
      setInputUrl('');
      // 通話中なら相手にもロードを通知
      if (isCallActive) {
        getSocket().emit('youtube-load', { videoId: id });
      }
    }
  };

  useEffect(() => {
    if (!isCallActive) return;

    const socket = getSocket();

    const handleRemoteLoad = (data: { videoId: string }) => {
      setVideoId(data.videoId);
    };

    const handleRemotePlay = (data: { time: number }) => {
      if (playerRef.current) {
        isRemoteOperation.current = true;
        const currentTime = playerRef.current.getCurrentTime();
        if (Math.abs(currentTime - data.time) > 2) {
          playerRef.current.seekTo(data.time, true);
        }
        playerRef.current.playVideo();
        setTimeout(() => { isRemoteOperation.current = false; }, 500);
      }
    };

    const handleRemotePause = (data: { time: number }) => {
      if (playerRef.current) {
        isRemoteOperation.current = true;
        const currentTime = playerRef.current.getCurrentTime();
        if (Math.abs(currentTime - data.time) > 2) {
          playerRef.current.seekTo(data.time, true);
        }
        playerRef.current.pauseVideo();
        setTimeout(() => { isRemoteOperation.current = false; }, 500);
      }
    };

    const handleRemoteSeek = (data: { time: number }) => {
      if (playerRef.current) {
        isRemoteOperation.current = true;
        playerRef.current.seekTo(data.time, true);
        setTimeout(() => { isRemoteOperation.current = false; }, 500);
      }
    };

    socket.on('youtube-load', handleRemoteLoad);
    socket.on('youtube-play', handleRemotePlay);
    socket.on('youtube-pause', handleRemotePause);
    socket.on('youtube-seek', handleRemoteSeek);

    return () => {
      socket.off('youtube-load', handleRemoteLoad);
      socket.off('youtube-play', handleRemotePlay);
      socket.off('youtube-pause', handleRemotePause);
      socket.off('youtube-seek', handleRemoteSeek);
    };
  }, [isCallActive]);

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    playerRef.current = event.target;
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    if (!isCallActive || isRemoteOperation.current) return;

    const socket = getSocket();
    const currentTime = event.target.getCurrentTime();

    // PlayerState.PLAYING = 1
    // PlayerState.PAUSED = 2
    if (event.data === 1) {
      socket.emit('youtube-play', { time: currentTime });
    } else if (event.data === 2) {
      socket.emit('youtube-pause', { time: currentTime });
    }
  };

  // オプション（プレイヤーのスタイル等）
  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 1,
      modestbranding: 1,
      rel: 0,
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
      {/* 上部：URL入力バー */}
      <div style={{ display: 'flex', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'center', gap: '8px' }}>
        <IconVideo size={20} color="#FF0000" />
        <span style={{ fontWeight: 'bold', fontSize: '14px', marginRight: '8px' }}>
          {language === 'en' ? 'Watch Party' : '同時視聴'}
        </span>
        <div style={{ flex: 1, display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '20px', padding: '4px 12px', alignItems: 'center' }}>
          <IconSearch size={14} color="rgba(255,255,255,0.4)" style={{ marginRight: '8px' }} />
          <input
            type="text"
            placeholder={language === 'en' ? 'Paste YouTube URL or Video ID...' : 'YouTubeのURLまたは動画IDを貼り付け...'}
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoadVideo()}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </div>
        <button
          onClick={handleLoadVideo}
          style={{
            background: '#FF0000',
            color: '#fff',
            border: 'none',
            borderRadius: '16px',
            padding: '6px 16px',
            fontSize: '13px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          {language === 'en' ? 'Load' : '開く'}
        </button>
      </div>

      {/* 中央：プレイヤーエリア */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
        {videoId ? (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <YouTube
              videoId={videoId}
              opts={opts}
              onReady={onPlayerReady}
              onStateChange={onPlayerStateChange}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
            <IconVideo size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <p style={{ fontSize: '14px' }}>
              {language === 'en' 
                ? 'Enter a YouTube URL to start watching together.' 
                : 'YouTubeのURLを入力して、一緒に動画を視聴しましょう。'}
            </p>
            {isCallActive && (
              <p style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px', color: '#4ade80' }}>
                {language === 'en' ? '✓ Sync is enabled during call' : '✓ 通話中は再生・一時停止が自動で同期されます'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
