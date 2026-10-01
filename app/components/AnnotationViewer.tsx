'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { IconX, IconTrash2, IconPencil } from '../Icons';

interface AnnotationViewerProps {
  imageUrl: string;
  onClose: () => void;
  sendDrawStroke: (data: { x0: number; y0: number; x1: number; y1: number; color: string; width: number }) => void;
  sendClearCanvas: () => void;
  setDrawCallbacks: (onDraw: (data: { x0: number; y0: number; x1: number; y1: number; color: string; width: number }) => void, onClear: () => void) => void;
  onSave: (file: File) => void;
  language?: string;
}

export default function AnnotationViewer({
  imageUrl,
  onClose,
  sendDrawStroke,
  sendClearCanvas,
  setDrawCallbacks,
  onSave,
  language = 'ja'
}: AnnotationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#FF3366');
  const [lineWidth, setLineWidth] = useState(3);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  // キャンバスのサイズを画像に合わせる
  const resizeCanvas = useCallback(() => {
    if (canvasRef.current && imageRef.current) {
      canvasRef.current.width = imageRef.current.clientWidth;
      canvasRef.current.height = imageRef.current.clientHeight;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // 他からの描画イベントを受信
  useEffect(() => {
    const onDraw = (data: { x0: number; y0: number; x1: number; y1: number; color: string; width: number }) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !canvasRef.current) return;
      // 受信座標は 0~1 の相対座標に正規化して送受信する
      const w = canvasRef.current.width;
      const h = canvasRef.current.height;
      ctx.beginPath();
      ctx.moveTo(data.x0 * w, data.y0 * h);
      ctx.lineTo(data.x1 * w, data.y1 * h);
      ctx.strokeStyle = data.color;
      ctx.lineWidth = data.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    const onClear = () => {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    };

    setDrawCallbacks(onDraw, onClear);

    return () => {
      setDrawCallbacks(() => {}, () => {});
    };
  }, [setDrawCallbacks]);

  const getPointerPos = (e: React.PointerEvent | PointerEvent) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    setIsDrawing(true);
    const pos = getPointerPos(e);
    lastPos.current = pos;
    // 初期の点描画
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing || !lastPos.current || !canvasRef.current) return;
    const currentPos = getPointerPos(e);
    
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(lastPos.current.x, lastPos.current.y);
      ctx.lineTo(currentPos.x, currentPos.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 0~1の相対座標に変換して送信
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    sendDrawStroke({
      x0: lastPos.current.x / w,
      y0: lastPos.current.y / h,
      x1: currentPos.x / w,
      y1: currentPos.y / h,
      color,
      width: lineWidth,
    });

    lastPos.current = currentPos;
  };

  const handlePointerUp = () => {
    setIsDrawing(false);
    lastPos.current = null;
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      sendClearCanvas();
    }
  };

  const handleSave = () => {
    if (!imageRef.current || !canvasRef.current) return;
    const targetCanvas = document.createElement('canvas');
    targetCanvas.width = imageRef.current.naturalWidth;
    targetCanvas.height = imageRef.current.naturalHeight;
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return;

    // 1. 画像を描画
    ctx.drawImage(imageRef.current, 0, 0, targetCanvas.width, targetCanvas.height);
    // 2. その上にキャンバス（描画内容）を描画
    ctx.drawImage(canvasRef.current, 0, 0, targetCanvas.width, targetCanvas.height);

    targetCanvas.toBlob((blob) => {
      if (blob) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const file = new File([blob], `annotated_${timestamp}.png`, { type: 'image/png' });
        onSave(file);
        onClose(); // 保存したら閉じる
      }
    }, 'image/png');
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div 
        ref={containerRef}
        style={{ position: 'relative', width: '90%', height: '90%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', paddingBottom: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input 
              type="color" 
              value={color} 
              onChange={e => setColor(e.target.value)} 
              style={{ width: 32, height: 32, cursor: 'pointer', border: 'none', background: 'transparent' }} 
              title={language === 'en' ? 'Color' : '色'}
            />
            <input 
              type="range" 
              min="1" max="20" 
              value={lineWidth} 
              onChange={e => setLineWidth(Number(e.target.value))}
              style={{ width: 100 }}
              title={language === 'en' ? 'Thickness' : '太さ'}
            />
            <button
              onClick={clearCanvas}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem' }}
            >
              <IconTrash2 size={16} /> {language === 'en' ? 'Clear' : 'クリア'}
            </button>
            <button
              onClick={handleSave}
              style={{ background: '#FF6A36', border: 'none', color: '#fff', cursor: 'pointer', padding: '6px 16px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem', fontWeight: 'bold' }}
            >
              <IconPencil size={16} /> {language === 'en' ? 'Save & Share' : '保存して共有'}
            </button>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '1rem', padding: '8px' }}
          >
            <IconX size={24} /> {language === 'en' ? 'Close' : '閉じる'}
          </button>
        </div>
        
        <div style={{ position: 'relative', maxWidth: '100%', maxHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            ref={imageRef}
            src={imageUrl} 
            alt="Preview" 
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block', userSelect: 'none' }} 
            onLoad={resizeCanvas}
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', cursor: 'crosshair', touchAction: 'none' }}
          />
        </div>
      </div>
    </div>
  );
}
