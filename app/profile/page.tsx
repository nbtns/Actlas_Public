'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { IconArrowLeft, IconCalendar } from '@/app/Icons';

interface ProfileData {
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  photoPositionX: number;
  photoPositionY: number;
  photoZoom: number;
  user: {
    name: string;
  };
  menus: Array<{
    id: string;
    name: string;
    description: string | null;
    price: number;
    duration: number;
  }>;
  commercialLaw: { termsOfService?: string; refundPolicy?: string; address?: string; representative?: string; phone?: string; email?: string } | null;
}

export default function PublicProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/teacher-profile/public')
      .then(res => {
        if (!res.ok) throw new Error('Profile not found');
        return res.json();
      })
      .then(data => {
        setProfile(data.profile);
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#18181b', color: '#fff' }}>
        Loading...
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#18181b', color: '#fff' }}>
        <p>Instructor not found.</p>
        <button onClick={() => router.push('/login')} style={{ marginTop: 16, padding: '8px 16px', background: '#3b82f6', color: '#fff', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
          Back to Login
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#18181b', color: '#fff', padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* ヘッダー */}
        <button 
          onClick={() => router.push('/login')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', color: '#a1a1aa', cursor: 'pointer', marginBottom: 24, fontSize: 14 }}
        >
          <IconArrowLeft size={16} /> Back
        </button>

        {/* プロフィール基本情報 */}
        <div style={{ background: '#27272a', borderRadius: 12, padding: 32, marginBottom: 24, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ width: 100, height: 100, borderRadius: '50%', background: '#3f3f46', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
            {profile.photoUrl ? (
              <Image
                src={profile.photoUrl}
                alt={profile.user.name}
                fill
                sizes="100px"
                style={{
                  objectFit: 'cover',
                  objectPosition: `${profile.photoPositionX ?? 50}% ${profile.photoPositionY ?? 50}%`,
                  transform: `scale(${(profile.photoZoom ?? 100) / 100})`,
                  transformOrigin: `${profile.photoPositionX ?? 50}% ${profile.photoPositionY ?? 50}%`,
                }}
                unoptimized
              />
            ) : (
              <span style={{ fontSize: 32, fontWeight: 'bold' }}>{profile.user.name[0]}</span>
            )}
          </div>
          <div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: 28, fontWeight: 'bold' }}>{profile.user.name}</h1>
            <p style={{ margin: '0 0 16px 0', fontSize: 16, color: '#a1a1aa' }}>{profile.title || 'Online Instructor'}</p>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{profile.bio || ''}</p>
          </div>
        </div>

        {/* レッスンメニュー */}
        <h2 style={{ fontSize: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconCalendar size={20} /> Lesson Menu
        </h2>
        <div style={{ display: 'grid', gap: 16, marginBottom: 40 }}>
          {profile.menus.length === 0 ? (
            <p style={{ color: '#a1a1aa' }}>No lesson menus available.</p>
          ) : (
            profile.menus.map(menu => (
              <div key={menu.id} style={{ background: '#27272a', borderRadius: 8, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: 18 }}>{menu.name}</h3>
                  <p style={{ margin: '0 0 8px 0', fontSize: 14, color: '#a1a1aa' }}>{menu.description}</p>
                  <div style={{ display: 'flex', gap: 12, fontSize: 14, color: '#cbd5e1' }}>
                    <span>🕒 {menu.duration} min</span>
                    <span>💰 ${menu.price.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* フッターリンク (特商法 & プライバシーポリシー) */}
        <div style={{ textAlign: 'center', paddingTop: 40, borderTop: '1px solid #3f3f46', display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }}>
          {profile.commercialLaw && (
            <Link 
              href="/legal"
              style={{ color: '#a1a1aa', textDecoration: 'underline', fontSize: 14 }}
            >
              Legal &amp; Policies / 特定商取引法に基づく表記
            </Link>
          )}
          <Link 
            href="/privacy" 
            style={{ color: '#a1a1aa', textDecoration: 'underline', fontSize: 14 }}
          >
            Privacy Policy / プライバシーポリシー
          </Link>
        </div>
      </div>
    </div>
  );
}
