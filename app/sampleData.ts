/**
 * サンプルデータ（開発用）
 * 本番ではPostgreSQLから取得する
 */

export interface User {
  id: string;
  name: string;
  role: 'teacher' | 'student';
  language: string;
  initials: string;
  avatarColor: string;
}

export interface Channel {
  id: string;
  roomId: string;
  name: string;
  type: 'chat' | 'material' | 'lesson_record' | 'booking' | 'custom';
  icon: string;
  sortOrder: number;
}

export interface Room {
  id: string;
  studentId: string;
  studentName: string;
  channels: Channel[];
  unreadCount: number;
  lastMessage?: string;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  content: string;
  type: 'text' | 'file' | 'system' | 'lesson_summary';
  fileName?: string;
  createdAt: string;
}

// --- サンプルユーザー ---
export const currentUser: User = {
  id: 'teacher-1',
  name: 'デモ先生',
  role: 'teacher',
  language: 'ja',
  initials: 'J',
  avatarColor: '#22c55e',
};

export const sampleStudents: User[] = [
  { id: 'student-1', name: 'デモ生徒1', role: 'student', language: 'ja', initials: '田', avatarColor: '#8b5cf6' },
  { id: 'student-2', name: 'Demo Student 2', role: 'student', language: 'en', initials: 'JS', avatarColor: '#3b82f6' },
  { id: 'student-3', name: 'Demo Student 3', role: 'student', language: 'es', initials: 'MG', avatarColor: '#f59e0b' },
];

// --- チャンネルテンプレート ---
function createDefaultChannels(roomId: string): Channel[] {
  return [
    { id: `${roomId}-chat`, roomId, name: '一般チャット', type: 'chat', icon: '💬', sortOrder: 0 },
    { id: `${roomId}-music`, roomId, name: '教材', type: 'material', icon: '📄', sortOrder: 1 },
    { id: `${roomId}-record`, roomId, name: 'レッスン記録', type: 'lesson_record', icon: '📝', sortOrder: 2 },
    { id: `${roomId}-booking`, roomId, name: '予約', type: 'booking', icon: '📅', sortOrder: 3 },
  ];
}

// --- サンプルルーム ---
export const sampleRooms: Room[] = [
  {
    id: 'room-1',
    studentId: 'student-1',
    studentName: 'デモ生徒1',
    channels: [
      ...createDefaultChannels('room-1'),
      { id: 'room-1-custom1', roomId: 'room-1', name: '練習動画', type: 'custom', icon: '🎥', sortOrder: 4 },
    ],
    unreadCount: 2,
    lastMessage: 'Am7のコード進行について質問です！',
  },
  {
    id: 'room-2',
    studentId: 'student-2',
    studentName: 'Demo Student 2',
    channels: createDefaultChannels('room-2'),
    unreadCount: 0,
    lastMessage: 'See you next Tuesday!',
  },
  {
    id: 'room-3',
    studentId: 'student-3',
    studentName: 'Demo Student 3',
    channels: createDefaultChannels('room-3'),
    unreadCount: 5,
    lastMessage: '¡Muchas gracias por la clase!',
  },
];

// --- サンプルメッセージ ---
export const sampleMessages: Record<string, Message[]> = {
  'room-1-chat': [
    { id: 'm1', channelId: 'room-1-chat', userId: 'student-1', content: 'こんにちは！来週のレッスンについて質問があります。', type: 'text', createdAt: '2026-05-12T10:00:00' },
    { id: 'm2', channelId: 'room-1-chat', userId: 'teacher-1', content: 'やあ生徒1さん！なんでも聞いてください 🎸', type: 'text', createdAt: '2026-05-12T10:02:00' },
    { id: 'm3', channelId: 'room-1-chat', userId: 'student-1', content: 'Am7のコード進行がうまくいかなくて...指の配置のコツってありますか？', type: 'text', createdAt: '2026-05-12T10:05:00' },
    { id: 'm4', channelId: 'room-1-chat', userId: 'teacher-1', content: '中指をしっかり立てるのがポイントだよ！次のレッスンで一緒に練習しよう。', type: 'text', createdAt: '2026-05-12T10:08:00' },
    { id: 'm5', channelId: 'room-1-chat', userId: 'student-1', content: 'ありがとうございます！楽しみにしてます！', type: 'text', createdAt: '2026-05-12T10:10:00' },
  ],
  'room-1-music': [
    { id: 'm6', channelId: 'room-1-music', userId: 'teacher-1', content: '', type: 'file', fileName: 'Am7_コード進行_練習シート.pdf', createdAt: '2026-05-10T14:00:00' },
    { id: 'm7', channelId: 'room-1-music', userId: 'teacher-1', content: 'この練習シートを次回までにやってみてね！', type: 'text', createdAt: '2026-05-10T14:01:00' },
    { id: 'm8', channelId: 'room-1-music', userId: 'student-1', content: '', type: 'file', fileName: '自主練_録音_0511.mp3', createdAt: '2026-05-11T20:00:00' },
    { id: 'm9', channelId: 'room-1-music', userId: 'student-1', content: '昨日練習してみました！聴いてみてください 🎵', type: 'text', createdAt: '2026-05-11T20:01:00' },
  ],
  'room-1-record': [
    { id: 'm10', channelId: 'room-1-record', userId: 'system', content: '🤖 レッスン記録が自動生成されました', type: 'system', createdAt: '2026-05-08T16:50:00' },
    { id: 'm11', channelId: 'room-1-record', userId: 'system', content: '## 授業概要\nAm7コード進行を中心に、フィンガーピッキングの基礎を練習。\n\n## 練習した内容\n- Am7 → Dm7 → G7 → Cmaj7 の循環コード\n- 右手のアルペジオパターン\n\n## 先生からのアドバイス\n- 中指をもっと立てること\n- テンポを落として正確さを重視\n\n## 次回までの宿題\n- メトロノーム60BPMで循環コードを10分/日', type: 'lesson_summary', createdAt: '2026-05-08T16:50:00' },
  ],
  'room-1-booking': [
    { id: 'm12', channelId: 'room-1-booking', userId: 'system', content: '📅 予約確定: 2026年5月15日（木）15:00〜15:50', type: 'system', createdAt: '2026-05-10T09:00:00' },
  ],
  'room-2-chat': [
    { id: 'm20', channelId: 'room-2-chat', userId: 'student-2', content: 'Hi! I really enjoyed last lesson. The blues scale is so fun!', type: 'text', createdAt: '2026-05-12T08:00:00' },
    { id: 'm21', channelId: 'room-2-chat', userId: 'teacher-1', content: "Glad to hear that! Let's try some improvisation next time 🎶", type: 'text', createdAt: '2026-05-12T08:05:00' },
  ],
};

// ユーザー情報取得用ヘルパー
export function getUserById(id: string): User | undefined {
  if (id === currentUser.id) return currentUser;
  return sampleStudents.find(s => s.id === id);
}

// 時間フォーマット
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// 日付フォーマット
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
