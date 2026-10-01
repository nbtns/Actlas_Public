'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { IconGlobe } from '../Icons';
import { PUBLIC_DEMO } from '@/lib/public-demo';

/**
 * ログインページ
 * ダークテーマに合わせた美しいログイン画面
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeDemoRole, setActiveDemoRole] = useState<'TEACHER' | 'STUDENT' | null>(null);
  const [teachers, setTeachers] = useState<Array<{ username: string; title: string; user: { name: string } }>>([]);

  // 2FA用のステート
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [resendTimer, setResendTimer] = useState(0);

  // 再送信タイマーの処理
  useEffect(() => {
    if (resendTimer > 0) {
      const timerId = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timerId);
    }
  }, [resendTimer]);

  useEffect(() => {
    fetch('/api/teacher-profile/public')
      .then(res => res.json())
      .then(data => {
        if (data.profile) {
          setTeachers([data.profile]);
        } else if (data.profiles) {
          setTeachers(data.profiles);
        }
      })
      .catch(console.error);
  }, []);

  const handleDemoLogin = async (role: 'TEACHER' | 'STUDENT') => {
    if (isLoading) return;
    setError('');
    setActiveDemoRole(role);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoRole: role }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'デモへのログインに失敗しました');
      }
      router.push('/');
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '接続できませんでした。もう一度お試しください。');
      setIsLoading(false);
      setActiveDemoRole(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        setIsLoading(false);
        return;
      }

      if (data.requires2FA) {
        setRequires2FA(true);
        setIsLoading(false);
        setResendTimer(60); // 60秒は再送信できないようにする
        return;
      }

      // ログイン成功 → メインページへ
      router.push('/');
      router.refresh();
    } catch {
      setError('Connection error');
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: twoFactorCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Verification failed');
        setIsLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Connection error');
      setIsLoading(false);
    }
  };

  const handleResend2FA = async () => {
    if (resendTimer > 0) return;
    setError('');
    
    try {
      const res = await fetch('/api/auth/resend-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error || 'Failed to resend code');
        return;
      }
      
      setResendTimer(60); // 再度60秒間は押せないように
      setError('新しい認証コードをメールで送信しました。');
    } catch {
      setError('Connection error');
    }
  };

  return (
    <div className="login-page">
      {/* 背景の装飾 */}
      <div className="login-bg-glow login-bg-glow--1" />
      <div className="login-bg-glow login-bg-glow--2" />

      <div className="login-card">
        {/* ロゴ */}
        <div className="login-card__logo">
          <div className="login-card__logo-icon">
            <IconGlobe size={28} />
          </div>
          <h1 className="login-card__title">Actlas</h1>
          <p className="login-card__subtitle">Lesson Communication</p>
          {PUBLIC_DEMO && (
            <p style={{ margin: '12px 0 0', color: '#a1a1aa', fontSize: 12, lineHeight: 1.6, textAlign: 'center' }}>
              公開デモではAI翻訳・AI要約を停止しています。本来のサービスではメール認証と初回ログイン設定があります。
            </p>
          )}
        </div>

        {/* 公開デモは役割を選ぶだけでログイン */}
        {PUBLIC_DEMO ? (
          <div className="login-form" aria-busy={isLoading}>
            <p className="login-demo__hint">見たい画面を選んでください。入力は不要です。</p>
            {error && (
              <div role="alert" className="login-form__error" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </div>
            )}
            <button
              type="button"
              className="login-form__submit login-demo__button"
              aria-label="デモ先生としてログイン"
              onClick={() => void handleDemoLogin('TEACHER')}
              disabled={isLoading}
            >
              <span className="login-demo__label">
                {activeDemoRole === 'TEACHER' && <span className="login-form__spinner" aria-hidden="true" />}
                {activeDemoRole === 'TEACHER' ? '先生でログイン中…' : 'デモ先生としてログイン'}
              </span>
              <span className="login-demo__description">生徒のルーム・教材・予約を管理</span>
            </button>
            <button
              type="button"
              className="login-form__submit login-demo__button login-demo__button--student"
              aria-label="デモ生徒としてログイン"
              onClick={() => void handleDemoLogin('STUDENT')}
              disabled={isLoading}
            >
              <span className="login-demo__label">
                {activeDemoRole === 'STUDENT' && <span className="login-form__spinner" aria-hidden="true" />}
                {activeDemoRole === 'STUDENT' ? '生徒でログイン中…' : 'デモ生徒としてログイン'}
              </span>
              <span className="login-demo__description">チャット・教材・レッスン予約を体験</span>
            </button>
          </div>
        ) : !requires2FA ? (
          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="login-form__error" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </div>
            )}

            <div className="login-form__group">
              <label htmlFor="login-email" className="login-form__label">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                className="login-form__input"
                placeholder="admin@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className="login-form__group">
              <label htmlFor="login-password" className="login-form__label">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                className="login-form__input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="login-form__submit"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="login-form__spinner" />
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify2FA} className="login-form">
            {error && (
              <div className="login-form__error" style={{ whiteSpace: 'pre-wrap' }}>
                {error}
              </div>
            )}

            <div className="login-form__group">
              <label htmlFor="login-2fa" className="login-form__label">
                6-digit Authentication Code
              </label>
              <p style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '12px', lineHeight: 1.5 }}>
                登録済みのメールアドレスに認証コードを送信しました。<br />メールをご確認の上、6桁のコードを入力してください。（有効期限：5分）
              </p>
              <input
                id="login-2fa"
                type="text"
                maxLength={6}
                className="login-form__input"
                placeholder="123456"
                value={twoFactorCode}
                onChange={e => setTwoFactorCode(e.target.value)}
                required
                autoFocus
                style={{ textAlign: 'center', fontSize: '24px', letterSpacing: '4px' }}
              />
            </div>

            <button
              type="submit"
              className="login-form__submit"
              disabled={isLoading || twoFactorCode.length !== 6}
            >
              {isLoading ? (
                <span className="login-form__spinner" />
              ) : (
                'Verify Code'
              )}
            </button>

            <button
              type="button"
              onClick={handleResend2FA}
              disabled={resendTimer > 0}
              style={{
                marginTop: '16px',
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: resendTimer > 0 ? '#52525b' : '#3b82f6',
                fontSize: '14px',
                cursor: resendTimer > 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {resendTimer > 0 ? `Resend code in ${resendTimer}s` : 'Resend authentication code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRequires2FA(false);
                setError('');
                setTwoFactorCode('');
              }}
              style={{
                marginTop: '16px',
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#a1a1aa',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Back to Sign In
            </button>
          </form>
        )}

        <p className="login-card__footer">
          {PUBLIC_DEMO ? '先生・生徒それぞれの画面を体験できます' : 'Your account is issued by your instructor'}
        </p>

        {/* 公開されている先生一覧へのリンク */}
        {teachers.length > 0 && (
          <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <p style={{ fontSize: '14px', color: '#a1a1aa', textAlign: 'center', marginBottom: '16px' }}>
              Instructor of this platform
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {teachers.map(teacher => (
                <button
                  key={teacher.username}
                  onClick={() => router.push('/profile')}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    color: '#fff',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                  onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseOut={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                >
                  <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{teacher.user.name}</span>
                  {teacher.title && (
                    <span style={{ fontSize: '13px', color: '#a1a1aa' }}>{teacher.title}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
