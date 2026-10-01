'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconArrowLeft } from '@/app/Icons';

interface CommercialLawData {
  legalName: string;
  address: string;
  phone: string;
  businessHours?: string;
  priceExplanation?: string;
  paymentMethods?: string;
  deliveryTime?: string;
  cancellationPolicy: string;
  termsOfServiceEn?: string;
  refundPolicyEn?: string;
}

interface ProfileData {
  user: { name: string };
  commercialLaw: CommercialLawData | null;
}

export default function LegalPage() {
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

  if (error || !profile || !profile.commercialLaw) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#18181b', color: '#fff' }}>
        <p>Legal information is not available.</p>
        <button onClick={() => router.back()} style={{ marginTop: 16, padding: '8px 16px', background: '#3b82f6', color: '#fff', borderRadius: 4, border: 'none', cursor: 'pointer' }}>
          Go Back
        </button>
      </div>
    );
  }

  const law = profile.commercialLaw;

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: '#18181b', color: '#fff', padding: '40px 20px', fontFamily: 'sans-serif', lineHeight: 1.6 }}>
      <div style={{ maxWidth: 800, margin: '0 auto', background: '#27272a', padding: '40px', borderRadius: '12px' }}>
        <button
          onClick={() => router.back()}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#a1a1aa', background: 'transparent', border: 'none', cursor: 'pointer', marginBottom: 32, fontSize: 14 }}
        >
          <IconArrowLeft size={16} /> Back / 戻る
        </button>

        <h1 style={{ fontSize: 28, fontWeight: 'bold', marginBottom: 8, borderBottom: '1px solid #3f3f46', paddingBottom: 16 }}>
          Legal &amp; Policies / 特定商取引法に基づく表記
        </h1>
        <p style={{ marginBottom: 32, color: '#a1a1aa', fontSize: 14 }}>
          {profile.user.name}
        </p>

        {/* 英語ポリシー（先に表示） */}
        {(law.termsOfServiceEn || law.refundPolicyEn) && (
          <div style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 24, color: '#60a5fa' }}>
              Policies for International Users
            </h2>

            {law.termsOfServiceEn && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: '#fff' }}>Terms of Service</h3>
                <div style={{ fontSize: 14, color: '#d4d4d8', whiteSpace: 'pre-wrap', background: '#3f3f46', padding: 20, borderRadius: 8, lineHeight: 1.8 }}>
                  {law.termsOfServiceEn}
                </div>
              </div>
            )}

            {law.refundPolicyEn && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: '#fff' }}>Refund Policy</h3>
                <div style={{ fontSize: 14, color: '#d4d4d8', whiteSpace: 'pre-wrap', background: '#3f3f46', padding: 20, borderRadius: 8, lineHeight: 1.8 }}>
                  {law.refundPolicyEn}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 日本語（特定商取引法に基づく表記） */}
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 24, color: '#fff' }}>
            特定商取引法に基づく表記
          </h2>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              <tr>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa', width: '30%' }}>事業者の氏名</td>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46' }}>{law.legalName}</td>
              </tr>
              <tr>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>住所</td>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46' }}>{law.address}</td>
              </tr>
              <tr>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>電話番号</td>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46' }}>{law.phone}</td>
              </tr>
              {law.businessHours && (
                <tr>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>営業時間</td>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46' }}>{law.businessHours}</td>
                </tr>
              )}
              {law.priceExplanation && (
                <tr>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>販売価格</td>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', whiteSpace: 'pre-wrap' }}>{law.priceExplanation}</td>
                </tr>
              )}
              {law.paymentMethods && (
                <tr>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>支払方法</td>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46' }}>{law.paymentMethods}</td>
                </tr>
              )}
              {law.deliveryTime && (
                <tr>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>提供時期</td>
                  <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46' }}>{law.deliveryTime}</td>
                </tr>
              )}
              <tr>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', color: '#a1a1aa' }}>キャンセル<br/>ポリシー</td>
                <td style={{ padding: '12px 0', borderBottom: '1px solid #3f3f46', whiteSpace: 'pre-wrap' }}>{law.cancellationPolicy}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid #3f3f46', color: '#a1a1aa', fontSize: 14 }}>
          This information is disclosed in accordance with Japanese law (Act on Specified Commercial Transactions).
        </div>
      </div>
    </div>
  );
}
