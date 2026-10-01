import React, { useState, useEffect, useCallback } from 'react';
import { IconPencil, IconGlobe, IconUser } from '../Icons';

interface DashboardViewProps {
  studentId: string;
  isTeacher: boolean;
  onNameChange?: (newName: string) => void;
  language?: string;
}

interface StudentData {
  id: string;
  name: string;
  email: string;
  birthDate: string | null;
  gender: string | null;
  hobbies: string | null;
  favoriteArtists: string | null;
  goals: string | null;
  totalLessons: number;
  specialOfferEligible: boolean;
  language: string;
}

export default function DashboardView({ studentId, isTeacher, onNameChange, language = 'ja' }: DashboardViewProps) {
  const appMode = process.env.NEXT_PUBLIC_APP_MODE || 'guitar';
  const showFavoriteArtists = appMode === 'guitar';
  const [student, setStudent] = useState<StudentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<StudentData> & { lastName?: string; firstName?: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  const fetchStudentData = useCallback(() => {
    setIsLoading(true);
    fetch(`/api/students/${studentId}/dashboard`)
      .then(res => res.json())
      .then(data => {
        if (data.student) setStudent(data.student);
        setIsLoading(false);
      })
      .catch(err => {
        console.error('ダッシュボード情報取得エラー', err);
        setIsLoading(false);
      });
  }, [studentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStudentData();
  }, [fetchStudentData]);

  const handleEditClick = () => {
    if (!student) return;
    const parts = student.name ? student.name.split(/\s+/) : ['', ''];
    let lastName = '';
    let firstName = '';
    
    if (student.language === 'en') {
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    } else {
      lastName = parts[0] || '';
      firstName = parts.slice(1).join(' ') || '';
    }

    setEditData({
      name: student.name,
      lastName,
      firstName,
      birthDate: student.birthDate ? student.birthDate.split('T')[0] : '',
      gender: student.gender || '',
      hobbies: student.hobbies || '',
      favoriteArtists: student.favoriteArtists || '',
      goals: student.goals || '',
      totalLessons: student.totalLessons || 0,
      specialOfferEligible: student.specialOfferEligible || false,
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = { ...editData };
      if (payload.lastName !== undefined || payload.firstName !== undefined) {
        if (student?.language === 'en') {
          payload.name = `${payload.firstName || ''} ${payload.lastName || ''}`.trim();
        } else {
          payload.name = `${payload.lastName || ''} ${payload.firstName || ''}`.trim();
        }
      }
      delete payload.lastName;
      delete payload.firstName;

      const res = await fetch(`/api/students/${studentId}/dashboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.student) {
        setStudent(data.student);
        setIsEditing(false);
        // 名前が変更された場合、親コンポーネントに通知してサイドバーを更新
        if (data.student.name && onNameChange) {
          onNameChange(data.student.name);
        }
      } else {
        alert(language === 'en' ? 'Failed to save' : '保存に失敗しました');
      }
    } catch {
      alert(language === 'en' ? 'Network error occurred' : '通信エラーが発生しました');
    } finally {
      setIsSaving(false);
    }
  };

  const calculateAge = (birthDateString: string | null) => {
    if (!birthDateString) return '';
    const today = new Date();
    const birthDate = new Date(birthDateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return language === 'en' ? `${age} yrs` : `${age}歳`;
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return language === 'en' ? 'Not set' : '未設定';
    const d = new Date(dateString);
    return language === 'en' ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  if (isLoading) {
    return <div style={{ padding: '24px', color: '#a1a1aa' }}>{language === 'en' ? 'Loading...' : '読み込み中...'}</div>;
  }

  if (!student) {
    return <div style={{ padding: '24px', color: '#ef4444' }}>{language === 'en' ? 'Failed to load student information.' : '生徒情報の取得に失敗しました。'}</div>;
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', height: '100%', width: '100%' }}>
      <div className="dashboard-view" style={{ padding: '32px', maxWidth: '800px', margin: '0 auto', width: '100%', paddingBottom: '80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <IconUser size={24} /> {language === 'en' ? 'Student Dashboard' : '生徒ダッシュボード'}
        </h2>
        <div>
          {isTeacher && !isEditing && (
            <button className="modal__btn modal__btn--cancel" onClick={handleEditClick} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', width: 'auto', margin: 0 }}>
              <IconPencil size={16} /> {language === 'en' ? 'Edit' : '編集する'}
            </button>
          )}
          {isEditing && (
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="modal__btn modal__btn--cancel" onClick={() => setIsEditing(false)} disabled={isSaving} style={{ padding: '8px 16px', margin: 0 }}>{language === 'en' ? 'Cancel' : 'キャンセル'}</button>
              <button className="modal__btn modal__btn--submit" onClick={handleSave} disabled={isSaving} style={{ padding: '8px 16px', width: 'auto', margin: 0 }}>
                {isSaving ? (language === 'en' ? 'Saving...' : '保存中...') : (language === 'en' ? 'Save' : '保存する')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ background: '#27272a', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* 基本情報 */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
            
            {isEditing ? (
              <div className="info-block" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {student.language === 'en' ? (
                  <>
                    <div>
                      <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>First Name</div>
                      <input className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.firstName || ''} onChange={e => setEditData({...editData, firstName: e.target.value})} placeholder="e.g. John" />
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>Last Name</div>
                      <input className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.lastName || ''} onChange={e => setEditData({...editData, lastName: e.target.value})} placeholder="e.g. Smith" />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>姓 (Last Name)</div>
                      <input className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.lastName || ''} onChange={e => setEditData({...editData, lastName: e.target.value})} placeholder="例: 山田" />
                    </div>
                    <div>
                      <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>名 (First Name)</div>
                      <input className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.firstName || ''} onChange={e => setEditData({...editData, firstName: e.target.value})} placeholder="例: 太郎" />
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="info-block">
                <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Name' : '名前'}</div>
                <div style={{ fontSize: '16px' }}>{student.name}</div>
              </div>
            )}

            <div className="info-block">
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Email' : 'メールアドレス'}</div>
              <div style={{ fontSize: '16px' }}>{student.email}</div>
            </div>

            <div className="info-block">
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Date of Birth' : '生年月日'}</div>
              {isEditing ? (
                <input type="date" className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.birthDate || ''} onChange={e => setEditData({...editData, birthDate: e.target.value})} />
              ) : (
                <div style={{ fontSize: '16px' }}>{formatDate(student.birthDate)} <span style={{ color: '#a1a1aa', fontSize: '14px' }}>{calculateAge(student.birthDate) && `(${calculateAge(student.birthDate)})`}</span></div>
              )}
            </div>

            <div className="info-block">
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Gender' : '性別'}</div>
              {isEditing ? (
                <select className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.gender || ''} onChange={e => setEditData({...editData, gender: e.target.value})}>
                  <option value="">{language === 'en' ? 'Not set' : '未設定'}</option>
                  <option value={language === 'en' ? 'Male' : '男性'}>{language === 'en' ? 'Male' : '男性'}</option>
                  <option value={language === 'en' ? 'Female' : '女性'}>{language === 'en' ? 'Female' : '女性'}</option>
                  <option value={language === 'en' ? 'Other' : 'その他'}>{language === 'en' ? 'Other' : 'その他'}</option>
                </select>
              ) : (
                <div style={{ fontSize: '16px' }}>{student.gender || (language === 'en' ? 'Not set' : '未設定')}</div>
              )}
            </div>
            
          </div>
        </div>

        {/* 音楽プロフィール */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
            
            {showFavoriteArtists && (
              <div className="info-block">
                <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Favorite Artists / Genres' : '好きなアーティスト・ジャンル'}</div>
                {isEditing ? (
                  <input className="modal__input" style={{ background: '#3f3f46', marginTop: '4px' }} value={editData.favoriteArtists || ''} onChange={e => setEditData({...editData, favoriteArtists: e.target.value})} placeholder={language === 'en' ? "e.g. John Mayer, Blues" : "例: John Mayer, ブルース"} />
                ) : (
                  <div style={{ fontSize: '16px', minHeight: '24px' }}>{student.favoriteArtists || <span style={{ color: '#71717a' }}>{language === 'en' ? 'Not set' : '未設定'}</span>}</div>
                )}
              </div>
            )}

            <div className="info-block">
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Goals' : '目標'}</div>
              {isEditing ? (
                <textarea 
                  className="modal__input" 
                  style={{ background: '#3f3f46', marginTop: '4px', minHeight: '80px', resize: 'vertical' }} 
                  value={editData.goals || ''} 
                  onChange={e => setEditData({...editData, goals: e.target.value})} 
                  placeholder={language === 'en' ? "e.g. Play a live show at the school festival" : "例: 文化祭でバンドを組んでライブをする"} 
                />
              ) : (
                <div style={{ fontSize: '16px', minHeight: '48px', whiteSpace: 'pre-wrap' }}>{student.goals || <span style={{ color: '#71717a' }}>{language === 'en' ? 'Not set' : '未設定'}</span>}</div>
              )}
            </div>

            <div className="info-block">
              <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '4px' }}>{language === 'en' ? 'Hobbies & Others' : 'その他'}</div>
              {isEditing ? (
                <textarea 
                  className="modal__input" 
                  style={{ background: '#3f3f46', marginTop: '4px', minHeight: '80px', resize: 'vertical' }} 
                  value={editData.hobbies || ''} 
                  onChange={e => setEditData({...editData, hobbies: e.target.value})} 
                  placeholder={language === 'en' ? "Any other notes" : "その他特記事項など"}
                />
              ) : (
                <div style={{ fontSize: '16px', minHeight: '24px', whiteSpace: 'pre-wrap' }}>{student.hobbies || <span style={{ color: '#71717a' }}>{language === 'en' ? 'Not set' : '未設定'}</span>}</div>
              )}
            </div>

          </div>
        </div>

        {/* レッスン情報 */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            
            <div className="info-block" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                <IconGlobe size={16} /> {language === 'en' ? 'Total Lessons' : '通算レッスン回数'}
              </div>
              {isEditing ? (
                <input type="number" className="modal__input" style={{ background: '#3f3f46', marginTop: '4px', textAlign: 'center', fontSize: '20px', fontWeight: 'bold' }} value={editData.totalLessons === 0 ? 0 : editData.totalLessons || ''} onChange={e => { const val = parseInt(e.target.value); setEditData({...editData, totalLessons: isNaN(val) ? 0 : val}); }} />
              ) : (
                <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#ff6a36' }}>{student.totalLessons} <span style={{ fontSize: '16px', color: '#a1a1aa', fontWeight: 'normal' }}>{language === 'en' ? 'lessons' : '回'}</span></div>
              )}
            </div>

            {isTeacher && (
              <div className="info-block" style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '13px', color: '#a1a1aa', marginBottom: '8px' }}>
                  {language === 'en' ? 'Special Offer' : '特価ラベル'}
                </div>
                {isEditing ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#e4e4e7', cursor: 'pointer', minHeight: '42px' }}>
                    <input
                      type="checkbox"
                      checked={editData.specialOfferEligible === true}
                      onChange={e => setEditData({ ...editData, specialOfferEligible: e.target.checked })}
                      style={{ width: 18, height: 18 }}
                    />
                    <span>{language === 'en' ? 'Use special prices' : '特価料金で予約できる'}</span>
                  </label>
                ) : (
                  <div style={{ fontSize: '16px', fontWeight: 'bold', color: student.specialOfferEligible ? '#34d399' : '#a1a1aa' }}>
                    {student.specialOfferEligible ? (language === 'en' ? 'Enabled' : '対象') : (language === 'en' ? 'Off' : '対象外')}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        </div>

      </div>
    </div>
  );
}
