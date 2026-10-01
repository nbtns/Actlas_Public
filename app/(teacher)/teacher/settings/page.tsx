'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TeacherSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    // 画面全体のリロードではなく、ルートへのリダイレクトとして扱う
    // メイン画面側で URLパラメータ（?view=...）を見るような実装がなければ、単に '/' に飛ばす
    router.push('/');
  }, [router]);
  return null;
}
