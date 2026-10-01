'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { IconSettings, IconUser } from '@/app/Icons';
import { ArrowDown, ArrowUp, CreditCard, GripVertical } from 'lucide-react';

interface CommercialLawInfo {
  legalName: string;
  address: string;
  phone: string;
  businessHours: string;
  priceExplanation: string;
  paymentMethods: string;
  deliveryTime: string;
  cancellationPolicy: string;
}

interface LessonMenu {
  id: string;
  name: string;
  description: string | null;
  price: number;
  specialPrice: number | null;
  duration: number;
  displayOrder: number;
}

interface TeacherSettingsViewProps {
  language?: string;
  onBack?: () => void;
}

export default function TeacherSettingsView({ language = 'ja' }: TeacherSettingsViewProps) {
  const [activeTab, setActiveTab] = useState<'profile' | 'stripe' | 'menus'>('profile');
  const [loading, setLoading] = useState(true);

  // プロフィール用ステート
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [photoPositionX, setPhotoPositionX] = useState(50);
  const [photoPositionY, setPhotoPositionY] = useState(50);
  const [photoZoom, setPhotoZoom] = useState(100);
  const [savingPhotoCrop, setSavingPhotoCrop] = useState(false);
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');

  const [commercialLaw, setCommercialLaw] = useState<CommercialLawInfo>({
    legalName: '', address: '', phone: '', businessHours: '',
    priceExplanation: '表示されている金額以外に、追加の手数料等は発生しません。',
    paymentMethods: 'クレジットカード決済 (Stripe)',
    deliveryTime: '予約したレッスン日時にオンラインで提供します。',
    cancellationPolicy: '1. キャンセルについて\nレッスン開始の24時間前までに手続きを行っていただいた場合、全額返金いたします。別の日程への振替も可能です。\n\n2. 直前のキャンセル・無断キャンセルについて\nレッスン開始まで24時間を切ってからのキャンセル、または事前の連絡なくレッスンに参加されなかった場合（無断キャンセル）は、原則として返金には応じかねます。\n\n3. 講師都合によるキャンセルについて\nやむを得ない事情により講師側からレッスンをキャンセルさせていただく場合は、全額返金、または別日程への振替にて対応いたします。',
  });
  
  const [termsOfServiceEn, setTermsOfServiceEn] = useState(
    '1. Service Overview: The services provided are online lessons/consultations via this platform.\n' +
    '2. User Responsibilities: Users are expected to have a stable internet connection and functioning audio/video equipment. Please join the session on time.\n' +
    '3. Prohibited Conduct: Recording, reproducing, or distributing the session content without explicit permission is strictly prohibited. Harassment or inappropriate behavior will result in immediate termination of the service without a refund.\n' +
    '4. Disclaimer: While we strive to provide the highest quality service, specific results or outcomes cannot be guaranteed.'
  );
  const [refundPolicyEn, setRefundPolicyEn] = useState(
    '1. Cancellations: You may cancel or reschedule your session up to 24 hours before the scheduled start time for a full refund.\n' +
    '2. Late Cancellations & No-shows: Cancellations made within 24 hours of the session, or failure to attend the session (no-shows), will not be eligible for a refund.\n' +
    '3. Provider Cancellations: In the rare event that the instructor must cancel a session, you will be offered a full refund or the option to reschedule.'
  );
  const [enableLawInfo, setEnableLawInfo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stripeConnectedAccountId, setStripeConnectedAccountId] = useState('');
  const [stripeConnectedAt, setStripeConnectedAt] = useState('');
  const [stripeConnectedLivemode, setStripeConnectedLivemode] = useState<boolean | null>(null);
  const [stripeConnectionMessage, setStripeConnectionMessage] = useState('');

  // レッスンメニュー用ステート
  const [menus, setMenus] = useState<LessonMenu[]>([]);
  const [isEditingMenu, setIsEditingMenu] = useState<string | null>(null);
  const [menuName, setMenuName] = useState('');
  const [menuDescription, setMenuDescription] = useState('');
  const [menuPrice, setMenuPrice] = useState('');
  const [menuSpecialPrice, setMenuSpecialPrice] = useState('');
  const [menuDuration, setMenuDuration] = useState('');
  const [draggingMenuId, setDraggingMenuId] = useState<string | null>(null);
  const [savingMenuOrder, setSavingMenuOrder] = useState(false);
  const [menuOrderError, setMenuOrderError] = useState('');

  // 初期データ取得
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [profileRes, menusRes] = await Promise.all([
          fetch('/api/teacher-profile'),
          fetch('/api/teacher/menus')
        ]);
        
        const profileData = await profileRes.json();
        const menusData = await menusRes.json();

        if (profileData.profile) {
          setUsername(profileData.profile.username || '');
          setAvatarUrl(profileData.profile.photoUrl || '');
          setPhotoPositionX(profileData.profile.photoPositionX ?? 50);
          setPhotoPositionY(profileData.profile.photoPositionY ?? 50);
          setPhotoZoom(profileData.profile.photoZoom ?? 100);
          setTitle(profileData.profile.title || '');
          setBio(profileData.profile.bio || '');
          setStripeConnectedAccountId(profileData.profile.stripeConnectedAccountId || '');
          setStripeConnectedAt(profileData.profile.stripeConnectedAt || '');
          setStripeConnectedLivemode(profileData.profile.stripeConnectedLivemode ?? null);

          if (profileData.profile.commercialLaw) {
            setCommercialLaw(profileData.profile.commercialLaw);
            setEnableLawInfo(true);
            if (profileData.profile.commercialLaw.termsOfServiceEn) {
              setTermsOfServiceEn(profileData.profile.commercialLaw.termsOfServiceEn);
            }
            if (profileData.profile.commercialLaw.refundPolicyEn) {
              setRefundPolicyEn(profileData.profile.commercialLaw.refundPolicyEn);
            }
          }
        }

        if (menusData.menus) {
          setMenus(menusData.menus);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get('stripe');
    if (!stripeStatus) return;

    const timeoutId = window.setTimeout(() => {
      setActiveTab('stripe');
      if (stripeStatus === 'connected') {
        const accountId = params.get('stripeAccount');
        if (accountId) setStripeConnectedAccountId(accountId);
        setStripeConnectionMessage(language === 'en' ? 'Stripe account connected.' : 'Stripeアカウントを連携しました。');
        return;
      }
      if (stripeStatus === 'not_configured') {
        setStripeConnectionMessage(language === 'en' ? 'Stripe OAuth is not configured yet.' : 'Stripe OAuth設定がまだ完了していません。');
        return;
      }
      if (stripeStatus === 'auth_required') {
        setStripeConnectionMessage(language === 'en' ? 'Please sign in as the teacher and try again.' : '先生アカウントでログインしてからもう一度お試しください。');
        return;
      }
      if (stripeStatus === 'connect_cancelled') {
        setStripeConnectionMessage(language === 'en' ? 'Stripe connection was cancelled.' : 'Stripe連携はキャンセルされました。');
        return;
      }
      setStripeConnectionMessage(language === 'en' ? 'Could not connect Stripe. Please try again.' : 'Stripe連携に失敗しました。もう一度お試しください。');
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [language]);

  const handleLawChange = (field: keyof CommercialLawInfo, value: string) => {
    setCommercialLaw({ ...commercialLaw, [field]: value });
  };

  const handleStripeConnect = () => {
    window.location.assign('/api/stripe/oauth/start');
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProfileError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch('/api/upload-avatar', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const userRes = await fetch('/api/teacher-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: data.url, photoPositionX: 50, photoPositionY: 50, photoZoom: 100 }),
      });
      if (!userRes.ok) throw new Error('アバターの更新に失敗しました');

      setAvatarUrl(data.url);
      setPhotoPositionX(50);
      setPhotoPositionY(50);
      setPhotoZoom(100);
      setProfileSuccess('アイコン画像を更新しました！');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (!confirm('本当に画像を削除しますか？')) return;
    
    setUploading(true);
    setProfileError('');
    try {
      const userRes = await fetch('/api/teacher-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: '', photoPositionX: 50, photoPositionY: 50, photoZoom: 100 }),
      });
      if (!userRes.ok) throw new Error('アバターの削除に失敗しました');

      setAvatarUrl('');
      setPhotoPositionX(50);
      setPhotoPositionY(50);
      setPhotoZoom(100);
      setProfileSuccess('アイコン画像を削除しました！');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoCropSave = async (overrides?: { x?: number; y?: number; zoom?: number }) => {
    const nextX = overrides?.x ?? photoPositionX;
    const nextY = overrides?.y ?? photoPositionY;
    const nextZoom = overrides?.zoom ?? photoZoom;
    setSavingPhotoCrop(true);
    setProfileError('');
    setProfileSuccess('');
    try {
      const res = await fetch('/api/teacher-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photoPositionX: nextX,
          photoPositionY: nextY,
          photoZoom: nextZoom,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '表示範囲の保存に失敗しました');
      setPhotoPositionX(data.profile?.photoPositionX ?? nextX);
      setPhotoPositionY(data.profile?.photoPositionY ?? nextY);
      setPhotoZoom(data.profile?.photoZoom ?? nextZoom);
      setProfileSuccess('写真の表示範囲を保存しました。');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingPhotoCrop(false);
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError('');
    setProfileSuccess('');

    try {
      const res = await fetch('/api/teacher-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          bio,
          commercialLaw: enableLawInfo ? {
            ...commercialLaw,
            termsOfServiceEn,
            refundPolicyEn
          } : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存に失敗しました');

      if (data.profile?.username) {
        setUsername(data.profile.username);
      }
      setProfileSuccess('プロフィールを保存しました！');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const fetchMenus = async () => {
    try {
      const res = await fetch('/api/teacher/menus');
      const data = await res.json();
      if (data.menus) setMenus(data.menus);
    } catch (err) {
      console.error(err);
    }
  };

  const saveMenuOrder = async (orderedMenus: LessonMenu[], previousMenus: LessonMenu[]) => {
    setSavingMenuOrder(true);
    setMenuOrderError('');
    try {
      const res = await fetch('/api/teacher/menus/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuIds: orderedMenus.map((menu) => menu.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save menu order');
      if (data.menus) setMenus(data.menus);
    } catch (err) {
      console.error(err);
      setMenus(previousMenus);
      setMenuOrderError('表示順の保存に失敗しました。もう一度入れ替えてください。');
    } finally {
      setSavingMenuOrder(false);
    }
  };

  const moveMenu = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= menus.length || toIndex >= menus.length) return;

    const previousMenus = menus;
    const orderedMenus = [...menus];
    const [movedMenu] = orderedMenus.splice(fromIndex, 1);
    orderedMenus.splice(toIndex, 0, movedMenu);
    setMenus(orderedMenus);
    saveMenuOrder(orderedMenus, previousMenus);
  };

  const handleMenuDrop = (targetMenuId: string) => {
    if (!draggingMenuId || draggingMenuId === targetMenuId) return;
    const fromIndex = menus.findIndex((menu) => menu.id === draggingMenuId);
    const toIndex = menus.findIndex((menu) => menu.id === targetMenuId);
    moveMenu(fromIndex, toIndex);
  };

  const resetMenuForm = () => {
    setMenuName('');
    setMenuDescription('');
    setMenuPrice('');
    setMenuSpecialPrice('');
    setMenuDuration('');
    setIsEditingMenu(null);
  };

  const handleEditMenu = (menu: LessonMenu) => {
    setIsEditingMenu(menu.id);
    setMenuName(menu.name);
    setMenuDescription(menu.description || '');
    setMenuPrice(menu.price.toString());
    setMenuSpecialPrice(menu.specialPrice?.toString() || '');
    setMenuDuration(menu.duration.toString());
  };

  const handleMenuSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!menuName || !menuPrice || !menuDuration) {
      alert('レッスン名、料金、時間は必須です。');
      return;
    }

    const price = Number(menuPrice);
    const specialPrice = menuSpecialPrice ? Number(menuSpecialPrice) : null;
    const duration = Number(menuDuration);
    if (!Number.isInteger(price) || price < 0) {
      alert('通常料金は0ドル以上の整数で入力してください。');
      return;
    }
    if (specialPrice !== null && (!Number.isInteger(specialPrice) || specialPrice < 0)) {
      alert('特価料金は0ドル以上の整数で入力してください。');
      return;
    }
    if (specialPrice !== null && specialPrice > price) {
      alert('特価料金は通常料金以下にしてください。');
      return;
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 240 || duration % 15 !== 0) {
      alert('時間は15分から240分までの15分単位で入力してください。');
      return;
    }

    const payload = {
      name: menuName.trim(),
      description: menuDescription,
      price,
      specialPrice,
      duration,
    };

    try {
      if (isEditingMenu) {
        await fetch(`/api/teacher/menus/${isEditingMenu}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch('/api/teacher/menus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      resetMenuForm();
      fetchMenus();
    } catch (err) {
      console.error(err);
      alert('保存に失敗しました。');
    }
  };

  const handleDeleteMenu = async (id: string) => {
    if (!confirm('本当にこのメニューを削除しますか？')) return;
    try {
      await fetch(`/api/teacher/menus/${id}`, { method: 'DELETE' });
      fetchMenus();
    } catch (err) {
      console.error(err);
      alert('削除に失敗しました。');
    }
  };

  if (loading) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>読み込み中...</div>;
  }

  const inputStyle = { width: '100%', padding: '12px', background: '#3f3f46', border: '1px solid #52525b', borderRadius: 6, color: '#fff', marginBottom: 16 };
  const labelStyle = { display: 'block', marginBottom: 8, fontSize: 14, color: '#cbd5e1', fontWeight: 'bold' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '40px 20px', animation: 'fadeIn 0.4s ease' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8, color: '#f1f5f9' }}>
          <IconSettings size={24} /> {language === 'en' ? 'Profile & Menu Settings' : '公開プロフィール・メニュー設定'}
        </h1>

        {/* タブナビゲーション */}
        <div style={{ display: 'flex', gap: 16, borderBottom: '1px solid #3f3f46', marginBottom: 32 }}>
          <button 
            onClick={() => setActiveTab('profile')}
            style={{ 
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 16px', fontSize: 16, fontWeight: 'bold',
              color: activeTab === 'profile' ? '#60a5fa' : '#a1a1aa',
              borderBottom: activeTab === 'profile' ? '2px solid #60a5fa' : '2px solid transparent'
            }}
          >
            {language === 'en' ? 'Public Profile' : '公開プロフィール'}
          </button>
          <button
            onClick={() => setActiveTab('stripe')}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 16px', fontSize: 16, fontWeight: 'bold',
              color: activeTab === 'stripe' ? '#60a5fa' : '#a1a1aa',
              borderBottom: activeTab === 'stripe' ? '2px solid #60a5fa' : '2px solid transparent'
            }}
          >
            {language === 'en' ? 'Stripe' : 'Stripe連携'}
          </button>
          <button 
            onClick={() => setActiveTab('menus')}
            style={{ 
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '12px 16px', fontSize: 16, fontWeight: 'bold',
              color: activeTab === 'menus' ? '#60a5fa' : '#a1a1aa',
              borderBottom: activeTab === 'menus' ? '2px solid #60a5fa' : '2px solid transparent'
            }}
          >
            {language === 'en' ? 'Lesson Menus' : 'レッスンメニュー'}
          </button>
        </div>

        {/* タブコンテンツ：プロフィール設定 */}
        {activeTab === 'profile' && (
          <form onSubmit={handleProfileSave}>
            <div style={{ background: 'rgba(39, 39, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', padding: 32, borderRadius: 16, marginBottom: 32, backdropFilter: 'blur(12px)' }}>
              <h2 style={{ fontSize: 18, marginBottom: 24, borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: 12, color: '#f1f5f9' }}>基本情報</h2>
              
              <div style={{ display: 'flex', gap: 24, marginBottom: 24, alignItems: 'center' }}>
                <div style={{ width: 100, height: 100, flexShrink: 0, borderRadius: '50%', background: '#3f3f46', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  {avatarUrl ? (
                    avatarUrl.includes(':') ? (
                      <IconUser size={48} />
                    ) : (
                      <Image
                        src={avatarUrl}
                        alt="Avatar"
                        fill
                        sizes="100px"
                        style={{
                          objectFit: 'cover',
                          objectPosition: `${photoPositionX}% ${photoPositionY}%`,
                          transform: `scale(${photoZoom / 100})`,
                          transformOrigin: `${photoPositionX}% ${photoPositionY}%`,
                        }}
                        unoptimized
                      />
                    )
                  ) : (
                    <IconUser size={48} />
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <label style={{ cursor: uploading ? 'not-allowed' : 'pointer', background: '#3b82f6', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 14, fontWeight: 'bold', display: 'inline-block' }}>
                      {uploading ? '処理中...' : '画像を選択'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarUpload} disabled={uploading} />
                    </label>
                    {avatarUrl && (
                      <button type="button" onClick={handleAvatarDelete} disabled={uploading} style={{ cursor: uploading ? 'not-allowed' : 'pointer', background: '#3f3f46', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 14, fontWeight: 'bold', border: 'none' }}>
                        削除
                      </button>
                    )}
                  </div>
                  <p style={{ marginTop: 8, fontSize: 12, color: '#a1a1aa' }}>推奨サイズ: 400x400px (5MB以下の画像)</p>
                </div>
              </div>

              {avatarUrl && !avatarUrl.includes(':') && (
                <>
                  <label style={labelStyle}>{language === 'en' ? 'Photo framing' : '写真の表示範囲'}</label>
                  <div style={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, padding: 16, marginBottom: 24 }}>
                    <div style={{ display: 'grid', gap: 12 }}>
                      <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 13 }}>
                        <span>{language === 'en' ? 'Horizontal position' : '横の表示位置'}</span>
                        <input type="range" min="0" max="100" value={photoPositionX} onChange={e => setPhotoPositionX(Number(e.target.value))} />
                      </label>
                      <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 13 }}>
                        <span>{language === 'en' ? 'Vertical position' : '縦の表示位置'}</span>
                        <input type="range" min="0" max="100" value={photoPositionY} onChange={e => setPhotoPositionY(Number(e.target.value))} />
                      </label>
                      <label style={{ display: 'grid', gap: 6, color: '#cbd5e1', fontSize: 13 }}>
                        <span>{language === 'en' ? 'Zoom' : '拡大'}</span>
                        <input type="range" min="100" max="250" value={photoZoom} onChange={e => setPhotoZoom(Number(e.target.value))} />
                      </label>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handlePhotoCropSave()}
                          disabled={savingPhotoCrop}
                          style={{ cursor: savingPhotoCrop ? 'not-allowed' : 'pointer', background: '#2563eb', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 14, fontWeight: 'bold', border: 'none' }}
                        >
                          {savingPhotoCrop ? (language === 'en' ? 'Saving...' : '保存中...') : (language === 'en' ? 'Save framing' : '表示範囲を保存')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoPositionX(50);
                            setPhotoPositionY(50);
                            setPhotoZoom(100);
                            handlePhotoCropSave({ x: 50, y: 50, zoom: 100 });
                          }}
                          disabled={savingPhotoCrop}
                          style={{ cursor: savingPhotoCrop ? 'not-allowed' : 'pointer', background: '#3f3f46', color: '#fff', padding: '8px 16px', borderRadius: 6, fontSize: 14, fontWeight: 'bold', border: 'none' }}
                        >
                          {language === 'en' ? 'Reset' : '中央に戻す'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <label style={labelStyle}>あなたの公開用URL</label>
              <div style={{ background: '#3f3f46', padding: '12px', borderRadius: 6, marginBottom: 16, display: 'flex', alignItems: 'center' }}>
                <span style={{ color: '#60a5fa', wordBreak: 'break-all' }}>
                  https://{typeof window !== 'undefined' ? window.location.host : 'app.example.com'}/profile
                </span>
              </div>

              <label style={labelStyle}>肩書き・キャッチコピー</label>
              <input 
                type="text" 
                value={title} 
                onChange={e => setTitle(e.target.value)} 
                placeholder="例: プロギタリスト / オンラインギター講師"
                style={inputStyle}
              />

              <label style={labelStyle}>自己紹介文</label>
              <textarea 
                value={bio} 
                onChange={e => setBio(e.target.value)} 
                placeholder="あなたの経歴や、どんなレッスンをするかを書いてください。"
                style={{ ...inputStyle, minHeight: 120, resize: 'vertical' }}
              />
            </div>

            <div style={{ background: 'rgba(39, 39, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', padding: 32, borderRadius: 16, marginBottom: 32, backdropFilter: 'blur(12px)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: 12 }}>
                <h2 style={{ fontSize: 18, margin: 0, color: '#f1f5f9' }}>特定商取引法に基づく表記</h2>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#cbd5e1' }}>
                  <input type="checkbox" checked={enableLawInfo} onChange={e => setEnableLawInfo(e.target.checked)} style={{ width: 18, height: 18 }} />
                  <span>設定する (Stripe審査に必須)</span>
                </label>
              </div>

              {enableLawInfo && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
                  <label style={labelStyle}>事業者の氏名</label>
                  <input required type="text" value={commercialLaw.legalName} onChange={e => handleLawChange('legalName', e.target.value)} placeholder="本名（法人の場合は法人名）" style={inputStyle} />

                  <label style={labelStyle}>住所</label>
                  <input required type="text" value={commercialLaw.address} onChange={e => handleLawChange('address', e.target.value)} placeholder="例: 東京都〇〇区〇〇1-2-3" style={inputStyle} />

                  <label style={labelStyle}>電話番号</label>
                  <input required type="tel" value={commercialLaw.phone} onChange={e => handleLawChange('phone', e.target.value)} placeholder="例: 090-1234-5678" style={inputStyle} />

                  <label style={labelStyle}>営業時間・連絡可能時間 (任意)</label>
                  <input type="text" value={commercialLaw.businessHours} onChange={e => handleLawChange('businessHours', e.target.value)} placeholder="例: 平日 10:00 - 18:00" style={inputStyle} />

                  <label style={labelStyle}>キャンセル・返金ポリシー</label>
                  <textarea required value={commercialLaw.cancellationPolicy} onChange={e => handleLawChange('cancellationPolicy', e.target.value)} placeholder="例: レッスン開始24時間前までのキャンセルは全額返金します。それ以降の返金は致しかねます。" style={{ ...inputStyle, minHeight: 80 }} />

                  <label style={labelStyle}>販売価格について</label>
                  <textarea required value={commercialLaw.priceExplanation} onChange={e => handleLawChange('priceExplanation', e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />

                  <label style={labelStyle}>支払方法</label>
                  <input required type="text" value={commercialLaw.paymentMethods} onChange={e => handleLawChange('paymentMethods', e.target.value)} style={inputStyle} />

                  <label style={labelStyle}>サービスの提供時期</label>
                  <input required type="text" value={commercialLaw.deliveryTime} onChange={e => handleLawChange('deliveryTime', e.target.value)} style={inputStyle} />
                  
                  <h3 style={{ fontSize: 16, marginTop: 24, marginBottom: 16, color: '#60a5fa', borderBottom: '1px solid #3f3f46', paddingBottom: 8 }}>English Policies (海外向け)</h3>
                  
                  <label style={labelStyle}>Terms of Service (利用規約 - 英語)</label>
                  <textarea value={termsOfServiceEn} onChange={e => setTermsOfServiceEn(e.target.value)} placeholder="Terms and conditions for overseas users..." style={{ ...inputStyle, minHeight: 120 }} />

                  <label style={labelStyle}>Refund Policy (返金ポリシー - 英語)</label>
                  <textarea value={refundPolicyEn} onChange={e => setRefundPolicyEn(e.target.value)} placeholder="Refund policy for overseas users..." style={{ ...inputStyle, minHeight: 80 }} />
                </div>
              )}
            </div>

            <div style={{ marginTop: 32 }}>
              {profileError && <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', padding: 16, borderRadius: 8, marginBottom: 16 }}>{profileError}</div>}
              {profileSuccess && <div style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#6ee7b7', padding: 16, borderRadius: 8, marginBottom: 16 }}>{profileSuccess}</div>}
              <button type="submit" disabled={savingProfile} style={{ width: '100%', padding: '16px', background: '#3b82f6', color: '#fff', borderRadius: 8, border: 'none', fontSize: 16, fontWeight: 'bold', cursor: savingProfile ? 'not-allowed' : 'pointer', opacity: savingProfile ? 0.7 : 1, boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)' }}>
                {savingProfile ? '保存中...' : 'プロフィールを保存'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'stripe' && (
          <div>
            <div style={{ background: 'rgba(39, 39, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', padding: 32, borderRadius: 16, marginBottom: 32, backdropFilter: 'blur(12px)' }}>
              <h2 style={{ fontSize: 18, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, color: '#f1f5f9' }}>
                <CreditCard size={20} />
                {language === 'en' ? 'Stripe Account' : 'Stripeアカウント'}
              </h2>
              {stripeConnectionMessage && (
                <div style={{ background: stripeConnectedAccountId ? 'rgba(16, 185, 129, 0.16)' : 'rgba(251, 191, 36, 0.16)', border: stripeConnectedAccountId ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(251, 191, 36, 0.45)', color: stripeConnectedAccountId ? '#6ee7b7' : '#fcd34d', padding: 14, borderRadius: 8, marginBottom: 18 }}>
                  {stripeConnectionMessage}
                </div>
              )}

              <div style={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 10, padding: 18, marginBottom: 20 }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: '#cbd5e1', flexWrap: 'wrap' }}>
                    <span>{language === 'en' ? 'Status' : '状態'}</span>
                    <strong style={{ color: stripeConnectedAccountId ? '#6ee7b7' : '#fca5a5' }}>
                      {stripeConnectedAccountId ? (language === 'en' ? 'Connected' : '連携済み') : (language === 'en' ? 'Not connected' : '未連携')}
                    </strong>
                  </div>
                  {stripeConnectedAccountId && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: '#cbd5e1', flexWrap: 'wrap' }}>
                        <span>{language === 'en' ? 'Connected account' : '連携アカウント'}</span>
                        <code style={{ color: '#93c5fd', wordBreak: 'break-all' }}>{stripeConnectedAccountId}</code>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: '#cbd5e1', flexWrap: 'wrap' }}>
                        <span>{language === 'en' ? 'Mode' : 'モード'}</span>
                        <strong style={{ color: '#e5e7eb' }}>
                          {stripeConnectedLivemode === null ? '-' : stripeConnectedLivemode ? 'Live' : 'Test'}
                        </strong>
                      </div>
                      {stripeConnectedAt && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: '#cbd5e1', flexWrap: 'wrap' }}>
                          <span>{language === 'en' ? 'Connected at' : '連携日時'}</span>
                          <span style={{ color: '#e5e7eb' }}>{new Date(stripeConnectedAt).toLocaleString()}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleStripeConnect}
                style={{ width: '100%', padding: '16px', background: stripeConnectedAccountId ? '#3f3f46' : '#635bff', color: '#fff', borderRadius: 8, border: 'none', fontSize: 16, fontWeight: 'bold', cursor: 'pointer' }}
              >
                {stripeConnectedAccountId
                  ? (language === 'en' ? 'Connect another existing Stripe account' : '別の既存Stripeアカウントに接続し直す')
                  : (language === 'en' ? 'Connect existing Stripe account' : '既存Stripeアカウントで連携')}
              </button>
            </div>
          </div>
        )}

        {/* タブコンテンツ：レッスンメニュー設定 */}
        {activeTab === 'menus' && (
          <div>
            <p style={{ color: '#fbbf24', fontSize: '0.95rem', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              ⚠️ 生徒の言語に合わせた言語（例：英語圏の生徒向けなら英語）で入力してください。
            </p>

            <div style={{ background: 'rgba(39, 39, 42, 0.6)', border: '1px solid rgba(255, 255, 255, 0.05)', padding: '1.5rem', borderRadius: '16px', marginBottom: '2rem', backdropFilter: 'blur(12px)' }}>
              <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#f1f5f9' }}>
                {isEditingMenu ? 'メニューの編集' : '新しいメニューを追加'}
              </h2>
              <form onSubmit={handleMenuSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#a1a1aa' }}>レッスン名</label>
                    <input
                      type="text"
                      value={menuName}
                      onChange={(e) => setMenuName(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem', background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff' }}
                      placeholder="例: Free Trial Lesson"
                    />
                  </div>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#a1a1aa' }}>通常料金 (USD)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={menuPrice}
                      onChange={(e) => setMenuPrice(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem', background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff' }}
                      placeholder="例: 50"
                    />
                  </div>
                  <div style={{ flex: '1 1 120px' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#a1a1aa' }}>特価料金 (USD)</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={menuSpecialPrice}
                      onChange={(e) => setMenuSpecialPrice(e.target.value)}
                      style={{ width: '100%', padding: '0.75rem', background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff' }}
                      placeholder="例: 30"
                    />
                  </div>
                </div>
                
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#a1a1aa' }}>時間 (分)</label>
                  <input
                    type="number"
                    min="15"
                    max="240"
                    step="15"
                    value={menuDuration}
                    onChange={(e) => setMenuDuration(e.target.value)}
                    style={{ width: '100%', padding: '0.75rem', background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff' }}
                    placeholder="例: 60"
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#a1a1aa' }}>説明文 (任意)</label>
                  <textarea
                    value={menuDescription}
                    onChange={(e) => setMenuDescription(e.target.value)}
                    rows={3}
                    style={{ width: '100%', padding: '0.75rem', background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff', resize: 'vertical' }}
                    placeholder="レッスンの内容を詳しく記載します"
                  />
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <button
                    type="submit"
                    style={{ background: '#8b5cf6', color: '#fff', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    {isEditingMenu ? '更新する' : '追加する'}
                  </button>
                  {isEditingMenu && (
                    <button
                      type="button"
                      onClick={resetMenuForm}
                      style={{ background: '#3f3f46', color: '#fff', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '8px', cursor: 'pointer' }}
                    >
                      キャンセル
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div>
              <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', color: '#f1f5f9' }}>登録済みのメニュー</h2>
              <p style={{ color: '#a1a1aa', fontSize: '0.9rem', marginBottom: '1rem' }}>
                左のハンドルをつかんで上下に動かすと、公開プロフィールで見える順番も変わります。
                {savingMenuOrder ? ' 保存中...' : ''}
              </p>
              {menuOrderError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                  {menuOrderError}
                </div>
              )}
              {menus.length === 0 ? (
                <p style={{ color: '#a1a1aa', padding: '2rem', background: 'rgba(39, 39, 42, 0.6)', borderRadius: '16px', textAlign: 'center' }}>
                  まだメニューが登録されていません。
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {menus.map((menu, index) => (
                    <div
                      key={menu.id}
                      draggable={!savingMenuOrder}
                      onDragStart={() => setDraggingMenuId(menu.id)}
                      onDragEnd={() => setDraggingMenuId(null)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        handleMenuDrop(menu.id);
                        setDraggingMenuId(null);
                      }}
                      style={{
                        background: draggingMenuId === menu.id ? 'rgba(59, 130, 246, 0.16)' : 'rgba(39, 39, 42, 0.6)',
                        border: draggingMenuId === menu.id ? '1px solid rgba(96, 165, 250, 0.8)' : '1px solid rgba(255, 255, 255, 0.05)',
                        padding: '1.25rem',
                        borderRadius: '16px',
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                        gap: '1rem',
                        alignItems: 'center',
                        opacity: savingMenuOrder ? 0.72 : 1,
                        transition: 'border-color 0.16s ease, background 0.16s ease, opacity 0.16s ease'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'center' }}>
                        <div
                          title="ドラッグして並べ替え"
                          style={{ color: '#94a3b8', cursor: savingMenuOrder ? 'not-allowed' : 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}
                        >
                          <GripVertical size={20} />
                        </div>
                        <button
                          type="button"
                          title="上へ移動"
                          onClick={() => moveMenu(index, index - 1)}
                          disabled={index === 0 || savingMenuOrder}
                          style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid #3f3f46', background: '#18181b', color: '#fff', cursor: index === 0 || savingMenuOrder ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          title="下へ移動"
                          onClick={() => moveMenu(index, index + 1)}
                          disabled={index === menus.length - 1 || savingMenuOrder}
                          style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid #3f3f46', background: '#18181b', color: '#fff', cursor: index === menus.length - 1 || savingMenuOrder ? 'not-allowed' : 'pointer', opacity: index === menus.length - 1 ? 0.35 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#f1f5f9' }}>{menu.name}</h3>
                        <p style={{ color: '#a1a1aa', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                          {menu.duration}分 / 通常 ${menu.price.toLocaleString()}
                          {menu.specialPrice !== null ? ` / 特価 $${menu.specialPrice.toLocaleString()}` : ''}
                        </p>
                        {menu.specialPrice !== null && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(52, 211, 153, 0.16)', color: '#6ee7b7', fontSize: '0.78rem', fontWeight: 'bold', marginBottom: '0.6rem' }}>
                            特価料金あり
                          </div>
                        )}
                        {menu.description && (
                          <p style={{ color: '#d4d4d8', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{menu.description}</p>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleEditMenu(menu)}
                          style={{ background: '#3f3f46', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                        >
                          編集
                        </button>
                        <button
                          onClick={() => handleDeleteMenu(menu.id)}
                          style={{ background: '#ef4444', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
