/**
 * 使い方ガイド表示用コンポーネント
 * チャンネルパネル下部の「使い方ガイド」をクリックすると、チャットエリアにこのビューが表示される。
 * 先生/生徒で表示するセクションが異なる。
 */
import React, { useState } from 'react';
import {
  IconChat, IconCalendar, IconVideo, IconGuide,
  IconNotepad, IconMemo, IconSettings, IconUser,
  IconChevronRight,
  IconBot, IconFileText
} from '../Icons';

interface GuideViewProps {
  userRole: 'TEACHER' | 'STUDENT';
  language?: string;
}

/** ガイドセクションの定義 */
interface GuideSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  /** 先生のみ表示するセクションか */
  teacherOnly?: boolean;
  steps: GuideStep[];
}

interface GuideStep {
  title: string;
  description: string;
}

/** ガイドセクションを取得する関数 */
function getGuideSections(lang: string = 'ja', appMode: string = 'guitar'): GuideSection[] {
  if (lang === 'en') {
    return [
      {
        id: 'chat',
        title: 'Chat',
        icon: <IconChat size={20} />,
        steps: [
          { title: 'Send a Message', description: 'Type text in the input field below and press Send or Enter. Use Shift + Enter for a new line.' },
          { title: 'Share Files', description: 'Click the paperclip icon or drag and drop files into the chat area to send images, PDFs, etc.' },
          { title: 'Message Actions', description: 'Right-click a message to edit, copy, reply, pin, copy link, or delete.' },
          { title: 'Pinning Messages', description: 'Right-click important messages and select "Pin" to make them stand out.' },
        ],
      },
      {
        id: 'material',
        title: 'Materials',
        icon: <IconFileText size={20} />,
        steps: [
          {
            title: 'About the Materials Channel',
            description: 'This is a dedicated space to organize and save PDFs, images, and audio files used in lessons.',
          },
          { title: 'Uploading Files', description: 'Send files just like in Chat. Images will show a preview, and other files will appear as download cards.' },
        ],
      },
      {
        id: 'booking',
        title: 'Booking Lessons',
        icon: <IconCalendar size={20} />,
        steps: [
          { title: 'Book via Calendar', description: 'Open the "Booking" channel to see a calendar. Click a date to view available time slots, and confirm your booking.' },
          { title: 'Check Bookings', description: 'Switch to the "Upcoming" tab to see all your scheduled lessons in a card view.' },
          { title: 'Cancel a Booking', description: 'Click the Cancel button on a booking to cancel it. Notifications are automatically posted to the channel.' },
        ],
      },
      {
        id: 'lesson',
        title: 'Online Lessons (Video Call)',
        icon: <IconVideo size={20} />,
        steps: [
          { title: 'Join a Lesson', description: 'When the teacher starts a lesson, a notification will appear. Click "Join" to switch to the video call view.' },
          { title: 'Call Controls', description: 'You can toggle your camera and microphone during the call. The green bar shows your real-time mic volume.' },
          { title: 'AI Translation (Coming Soon)', description: 'Real-time subtitles for Japanese/English will be displayed during the call.' },
          { title: 'End Lesson', description: 'Click the End button to leave the call. The AI will summarize the lesson and post it to the "Lesson Record" channel.' },
        ],
      },
      {
        id: 'memo',
        title: 'Memo',
        icon: <IconMemo size={20} />,
        steps: [
          { title: 'About Memo', description: 'The "Memo" channel is your personal notebook. Use it to jot down practice routines or things you want to remember.' },
        ],
      },
      {
        id: 'profile',
        title: 'Profile & Settings',
        icon: <IconSettings size={20} />,
        steps: [
          { title: 'Change Profile Icon', description: 'Click the gear icon in the bottom left to open Settings. Create your custom avatar using colors and icons.' },
          { title: 'Language Settings', description: 'Select between Japanese and English in the "Language" section. Future updates will also link this to chat translations.' },
        ],
      },
      {
        id: 'student-management',
        title: 'Student Management',
        icon: <IconUser size={20} />,
        teacherOnly: true,
        steps: [
          { title: 'Add a Student', description: 'Click "Add new student" at the bottom of the sidebar to register a student. This creates a dedicated room and channels.' },
          { title: 'Dashboard', description: 'Use the "Dashboard" channel in each student\'s room to manage their basic info, goals, and lesson counts.' },
        ],
      },
      {
        id: 'teacher-booking',
        title: 'Booking Management (Teacher)',
        icon: <IconCalendar size={20} />,
        teacherOnly: true,
        steps: [
          { title: 'Booking Page', description: 'Click "Booking Management" under the channel list to see all students\' bookings on a weekly timeline.' },
          { title: 'Block Time Slots', description: 'Register "Blocks" for times when you are unavailable. Students won\'t be able to book these slots.' },
          { title: 'Proxy Booking', description: 'You can also create bookings directly from a student\'s booking channel (useful for makeup lessons).' },
        ],
      },
      {
        id: 'lesson-record',
        title: 'Lesson Record',
        icon: <IconNotepad size={20} />,
        teacherOnly: true,
        steps: [
          { title: 'AI Summaries', description: 'After a lesson ends, the AI automatically summarizes it and posts it to the "Lesson Record" channel for later review.' },
        ],
      },
    ];
  }

  return [
    {
      id: 'chat',
      title: 'チャット',
      icon: <IconChat size={20} />,
      steps: [
        {
          title: 'メッセージを送る',
          description: '画面下の入力欄にテキストを入力し、送信ボタンを押すか Enter キーで送信できます。Shift + Enter で改行ができます。',
        },
        {
          title: 'ファイルを共有する',
          description: '入力欄の左にあるクリップアイコンをクリックするか、チャットエリアにファイルをドラッグ＆ドロップすると、画像やPDFなどのファイルを送信できます。',
        },
        {
          title: 'メッセージの操作',
          description: 'メッセージを右クリックすると、編集・コピー・返信・ピン留め・リンクコピー・削除の操作メニューが表示されます。',
        },
        {
          title: 'ピン留め',
          description: '大事なメッセージを右クリックして「ピン留め」すると、目立つ表示になり後から見つけやすくなります。',
        },
      ],
    },
    {
      id: 'material',
      title: '教材の共有',
      icon: <IconFileText size={20} />,
      steps: [
        {
          title: '教材チャンネルについて',
          description: '「教材」チャンネルは、レッスンで使うPDF・画像・音声ファイルを整理して保存するための専用スペースです。',
        },
        {
          title: 'ファイルのアップロード',
          description: 'チャットと同じ方法でファイルを送信できます。画像はプレビューが表示され、それ以外のファイルはダウンロードカードとして表示されます。',
        },
      ],
    },
    {
      id: 'booking',
      title: 'レッスンの予約',
      icon: <IconCalendar size={20} />,
      steps: [
        {
          title: 'カレンダーから予約する',
          description: '「予約」チャンネルを開くとカレンダーが表示されます。レッスンを受けたい日付をクリックすると、空いている時間帯が表示されるので、希望の時間を選んで予約を確定してください。',
        },
        {
          title: '予約の確認',
          description: '「予約一覧」タブに切り替えると、今後の予約がカード形式で一覧表示されます。',
        },
        {
          title: '予約のキャンセル',
          description: '予約一覧から、キャンセルしたい予約のキャンセルボタンを押すと取り消せます。予約・キャンセルの通知は自動でチャンネルに投稿されます。',
        },
      ],
    },
    {
      id: 'lesson',
      title: 'オンラインレッスン（通話）',
      icon: <IconVideo size={20} />,
      steps: [
        {
          title: 'レッスンに参加する',
          description: '先生がレッスンを開始すると、画面に着信の通知が表示されます。「参加する」を押すとビデオ通話画面に切り替わります。',
        },
        {
          title: '通話中の操作',
          description: '通話中はカメラ・マイクのオン/オフを切り替えられます。緑色のバーで自分のマイク音量をリアルタイムに確認できます。',
        },
        {
          title: 'AI翻訳（準備中）',
          description: '日本語と英語の翻訳機能が搭載されており、通話中の会話をリアルタイムで字幕表示できます。',
        },
        {
          title: 'レッスンの終了',
          description: '終了ボタンを押すと通話が終わり、チャット画面に戻ります。レッスン内容はAIが自動要約して「レッスン記録」に保存されます。',
        },
      ],
    },
    {
      id: 'memo',
      title: 'メモ',
      icon: <IconMemo size={20} />,
      steps: [
        {
          title: 'メモチャンネルについて',
          description: '「メモ」チャンネルは自由にメモを書ける個人ノートです。練習メニューや覚えたいことなどを気軽に書き留められます。',
        },
      ],
    },
    {
      id: 'profile',
      title: 'プロフィール・設定',
      icon: <IconSettings size={20} />,
      steps: [
        {
          title: 'プロフィールアイコンの変更',
          description: '画面左下の歯車アイコンから設定を開き、「プロフィールアイコン」セクションで、好きな色とアイコンの組み合わせでオリジナルのアバターを作れます。',
        },
        {
          title: '言語設定',
          description: '「使用する言語」セクションで、日本語または英語を選択できます。将来的にチャットの自動翻訳にも連動する予定です。',
        },
      ],
    },
    // --- 先生専用セクション ---
    {
      id: 'student-management',
      title: '生徒の管理',
      icon: <IconUser size={20} />,
      teacherOnly: true,
      steps: [
        {
          title: '生徒を追加する',
          description: '左サイドバー下の「新しい生徒を追加」ボタンから、生徒の名前・メールアドレス・初期パスワードを入力して登録できます。登録すると自動で専用のルームとチャンネルが作成されます。',
        },
        {
          title: 'ダッシュボードで情報管理',
          description: appMode === 'guitar'
            ? '各生徒のルーム内にある「ダッシュボード」チャンネル（先生専用）から、生徒の基本情報・好きなアーティスト・目標・レッスン回数などを確認・編集できます。'
            : '各生徒のルーム内にある「ダッシュボード」チャンネル（先生専用）から、生徒の基本情報・目標・レッスン回数などを確認・編集できます。',
        },
      ],
    },
    {
      id: 'teacher-booking',
      title: '予約管理（先生用）',
      icon: <IconCalendar size={20} />,
      teacherOnly: true,
      steps: [
        {
          title: '予約管理ページ',
          description: 'チャンネル一覧の下にある「予約管理」をクリックすると、全生徒の予約を週間タイムラインで一覧表示できます。',
        },
        {
          title: 'ブロック時間帯の設定',
          description: 'レッスン不可の時間帯を「ブロック」として登録できます。ブロックされた時間帯は、生徒の予約画面から選べなくなります。',
        },
        {
          title: '代理予約',
          description: '生徒の予約チャンネルを開くと、先生側から予約を作成することもできます（振替レッスンなどに便利です）。',
        },
      ],
    },
    {
      id: 'lesson-record',
      title: 'レッスン記録',
      icon: <IconNotepad size={20} />,
      teacherOnly: true,
      steps: [
        {
          title: 'AI自動要約',
          description: 'オンラインレッスン終了時に、AIがレッスン内容を自動的に要約し、「レッスン記録」チャンネルに投稿します。過去のレッスン内容を振り返るのに活用できます。',
        },
      ],
    },
  ];
}

/** アコーディオン1セクション */
function GuideSectionItem({ section, isOpen, onToggle, language }: {
  section: GuideSection;
  isOpen: boolean;
  onToggle: () => void;
  language: string;
}) {
  return (
    <div className="guide-section">
      <button className="guide-section__header" onClick={onToggle}>
        <div className="guide-section__header-left">
          <span className="guide-section__icon">{section.icon}</span>
          <span className="guide-section__title">{section.title}</span>
          {section.teacherOnly && (
            <span className="guide-section__badge">{language === 'en' ? 'Teacher Only' : '先生専用'}</span>
          )}
        </div>
        <span className={`guide-section__chevron ${isOpen ? 'guide-section__chevron--open' : ''}`}>
          <IconChevronRight size={16} />
        </span>
      </button>
      {isOpen && (
        <div className="guide-section__body">
          {section.steps.map((step, idx) => (
            <div key={idx} className="guide-step">
              <div className="guide-step__number">{idx + 1}</div>
              <div className="guide-step__content">
                <div className="guide-step__title">{step.title}</div>
                <div className="guide-step__desc">{step.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GuideView({ userRole, language = 'ja' }: GuideViewProps) {
  const appMode = process.env.NEXT_PUBLIC_APP_MODE || 'guitar';
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** ユーザーのロールに応じてフィルタリング */
  const visibleSections = getGuideSections(language, appMode).filter(s => {
    if (s.teacherOnly && userRole !== 'TEACHER') return false;
    return true;
  });

  /** 共通セクションと先生専用セクションを分割 */
  const commonSections = visibleSections.filter(s => !s.teacherOnly);
  const teacherSections = visibleSections.filter(s => s.teacherOnly);

  return (
    <div style={{ flex: 1, overflowY: 'auto', height: '100%', width: '100%' }}>
      <div className="guide-view">
        {/* ヘッダー */}
        <div className="guide-view__header">
          <div className="guide-view__header-icon">
            <IconGuide size={32} />
          </div>
          <div>
            <h2 className="guide-view__title">{language === 'en' ? 'How to use Actlas' : 'Actlas の使い方'}</h2>
            <p className="guide-view__subtitle">
              {language === 'en' 
                ? 'Discover how to use each feature section by section. Click on an item to expand it.'
                : '各機能の使い方をセクションごとにまとめています。知りたい項目をクリックして開いてください。'}
            </p>
          </div>
        </div>

        {/* 共通セクション */}
        <div className="guide-view__sections">
          {commonSections.map(section => (
            <GuideSectionItem
              key={section.id}
              section={section}
              isOpen={openSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              language={language}
            />
          ))}
        </div>

        {/* 先生専用セクション */}
        {teacherSections.length > 0 && (
          <>
            <div className="guide-view__divider">
              <span className="guide-view__divider-line" />
              <span className="guide-view__divider-label">{language === 'en' ? 'Teacher Features' : '先生向け機能'}</span>
              <span className="guide-view__divider-line" />
            </div>
            <div className="guide-view__sections">
              {teacherSections.map(section => (
                <GuideSectionItem
                  key={section.id}
                  section={section}
                  isOpen={openSections.has(section.id)}
                  onToggle={() => toggleSection(section.id)}
                  language={language}
                />
              ))}
            </div>
          </>
        )}

        {/* フッター */}
        <div className="guide-view__footer">
          <IconBot size={16} />
          <span>{language === 'en' ? 'If you have any questions, please ask your teacher in the Chat.' : '分からないことがあれば、チャットで先生に質問してください。'}</span>
        </div>
      </div>
    </div>
  );
}
