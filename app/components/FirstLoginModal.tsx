import React, { useState } from 'react';
import DatePicker, { registerLocale } from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ja, enUS } from 'date-fns/locale';

// ロケールの登録
registerLocale('ja', ja);
registerLocale('en', enUS);

interface FirstLoginModalProps {
  user: { name: string; isFirstLogin: boolean };
  onSave: (data: { name: string; birthDate: string; gender: string; timezone: string }) => Promise<void>;
  language?: string;
}

export default function FirstLoginModal({ user, onSave, language = 'ja' }: FirstLoginModalProps) {
  // ユーザーの初期名から姓と名を推測（初期化時に計算）
  const [lastName, setLastName] = useState(() => {
    if (!user.name) return '';
    const parts = user.name.split(/\s+/);
    return parts[0] || '';
  });
  const [firstName, setFirstName] = useState(() => {
    if (!user.name) return '';
    const parts = user.name.split(/\s+/);
    return parts.length >= 2 ? parts.slice(1).join(' ') : '';
  });
  const [birthDateObj, setBirthDateObj] = useState<Date | null>(null);
  const [gender, setGender] = useState('未回答');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setError('');
    if (!firstName || !lastName || !birthDateObj) {
      setError(language === 'en' ? 'Please fill in all required fields' : '必須項目を入力してください');
      return;
    }

    setIsSaving(true);
    try {
      // YYYY-MM-DD形式に変換 (ローカルタイムゾーンを基準にするため手動フォーマット)
      const year = birthDateObj.getFullYear();
      const month = String(birthDateObj.getMonth() + 1).padStart(2, '0');
      const day = String(birthDateObj.getDate()).padStart(2, '0');
      const birthDate = `${year}-${month}-${day}`;

      await onSave({
        name: `${lastName} ${firstName}`,
        birthDate,
        gender,
        timezone
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || (language === 'en' ? 'Failed to save' : '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!user.isFirstLogin) return null;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 450 }}>
        <div className="modal__header">
          {language === 'en' ? 'Profile Setup' : 'プロフィール登録'}
        </div>
        <div className="modal__body" style={{ padding: '24px', gap: '20px' }}>
          <p style={{ color: '#a1a1aa', fontSize: '14px', lineHeight: '1.5', margin: 0 }}>
            {language === 'en' ? 'Welcome to Actlas! Please enter your basic profile information before you start.' : 'Actlasへようこそ！始める前に、基本的なプロフィールを入力してください。'}
          </p>

          <div style={{ display: 'flex', gap: '12px' }}>
            <label className="modal__label" style={{ flex: 1 }}>
              {language === 'en' ? 'Last Name *' : '姓 (Last Name) *'}
              <input
                className="modal__input"
                style={{ background: '#27272a', marginTop: '6px' }}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={language === 'en' ? 'e.g. Smith' : '例: 山田'}
                required
              />
            </label>
            <label className="modal__label" style={{ flex: 1 }}>
              {language === 'en' ? 'First Name *' : '名 (First Name) *'}
              <input
                className="modal__input"
                style={{ background: '#27272a', marginTop: '6px' }}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={language === 'en' ? 'e.g. John' : '例: 太郎'}
                required
              />
            </label>
          </div>

          <label className="modal__label">
            {language === 'en' ? 'Date of Birth *' : '生年月日 *'}
            <div style={{ marginTop: '6px' }} className="actlas-datepicker-wrapper">
              <DatePicker
                selected={birthDateObj}
                onChange={(date: Date | null) => setBirthDateObj(date)}
                locale={language === 'en' ? 'en' : 'ja'}
                dateFormat={language === 'en' ? 'MM/dd/yyyy' : 'yyyy/MM/dd'}
                placeholderText={language === 'en' ? 'MM/DD/YYYY' : '年/月/日'}
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                maxDate={new Date()}
                className="modal__input"
                wrapperClassName="w-full"
                required
              />
            </div>
          </label>

          <label className="modal__label">
            {language === 'en' ? 'Gender' : '性別'}
            <select
              className="modal__input"
              style={{ background: '#27272a', marginTop: '6px' }}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value={language === 'en' ? 'Prefer not to say' : '未回答'}>{language === 'en' ? 'Prefer not to say' : '選択しない'}</option>
              <option value={language === 'en' ? 'Male' : '男性'}>{language === 'en' ? 'Male' : '男性'}</option>
              <option value={language === 'en' ? 'Female' : '女性'}>{language === 'en' ? 'Female' : '女性'}</option>
              <option value={language === 'en' ? 'Other' : 'その他'}>{language === 'en' ? 'Other' : 'その他'}</option>
            </select>
          </label>

          <label className="modal__label">
            {language === 'en' ? 'Timezone *' : 'タイムゾーン *'}
            <select
              className="modal__input"
              style={{ background: '#27272a', marginTop: '6px' }}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {Intl.supportedValuesOf('timeZone').map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </label>

          {error && <div className="modal__error">{error}</div>}

        </div>
        <div className="modal__footer">
          <button 
            className="modal__btn modal__btn--submit" 
            onClick={handleSave} 
            disabled={isSaving}
            style={{ width: '100%', padding: '12px' }}
          >
            {isSaving ? (language === 'en' ? 'Saving...' : '保存中...') : (language === 'en' ? 'Save & Start' : '登録して始める')}
          </button>
        </div>
      </div>
    </div>
  );
}
