'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket, type AppNotificationPayload } from '@/lib/socket';
import { ANNOUNCEMENT_REACTIONS, type AnnouncementUpdatedPayload } from '@/lib/announcement-shared';
import { IconMegaphone, IconPencil, IconSend, IconTrash2, IconX } from '../Icons';

type ReactionGroup = {
  emoji: string;
  count: number;
  students: { id: string; name: string }[];
};

type AnnouncementItem = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  isEdited: boolean;
  teacher: { id: string; name: string; avatarUrl: string | null };
  reactions: ReactionGroup[];
  currentUserEmojis: string[];
};

type AnnouncementsViewProps = {
  userRole: 'TEACHER' | 'STUDENT';
  language: string;
  onRead?: () => void;
  onUnread?: () => void;
};

type LoadOptions = {
  markReadIfViewed?: boolean;
  signalUnreadIfNotViewed?: boolean;
};

function safeLink(url: string): string | null {
  const trimmed = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch ? safeLink(linkMatch[2]) : null;
      if (linkMatch && href) {
        nodes.push(
          <a key={`${keyPrefix}-link-${match.index}`} href={href} target="_blank" rel="noopener noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: { text: string; line: number }[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${listItems[0].line}`}>
        {listItems.map((item) => (
          <li key={`item-${item.line}`}>{renderInline(item.text, `list-${item.line}`)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line, index) => {
    if (line.startsWith('- ') && !line.startsWith('-# ')) {
      listItems.push({ text: line.slice(2), line: index });
      return;
    }
    flushList();

    if (!line.trim()) {
      blocks.push(<div className="announcement-markdown__spacer" key={`blank-${index}`} />);
    } else if (line.startsWith('### ')) {
      blocks.push(<h3 key={`h3-${index}`}>{renderInline(line.slice(4), `h3-${index}`)}</h3>);
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={`h2-${index}`}>{renderInline(line.slice(3), `h2-${index}`)}</h2>);
    } else if (line.startsWith('# ')) {
      blocks.push(<h1 key={`h1-${index}`}>{renderInline(line.slice(2), `h1-${index}`)}</h1>);
    } else if (line.startsWith('-# ')) {
      blocks.push(<p className="announcement-markdown__subtext" key={`sub-${index}`}>{renderInline(line.slice(3), `sub-${index}`)}</p>);
    } else {
      blocks.push(<p key={`p-${index}`}>{renderInline(line, `p-${index}`)}</p>);
    }
  });
  flushList();

  return <div className="announcement-markdown">{blocks}</div>;
}

function formatAnnouncementDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function AnnouncementsView({ userRole, language, onRead, onUnread }: AnnouncementsViewProps) {
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [reactingKey, setReactingKey] = useState<string | null>(null);
  const targetScrolledRef = useRef(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const announcementsRef = useRef<AnnouncementItem[]>([]);
  const readCursorRef = useRef<string | null>(null);
  const lastReadCursorRef = useRef<string | null>(null);
  const readingCursorRef = useRef<string | null>(null);
  const loadSequenceRef = useRef(0);

  const isViewingLatest = useCallback(() => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
    return Boolean(viewRef.current && viewRef.current.scrollTop <= 24);
  }, []);

  const markReadThrough = useCallback(async (cursor: string) => {
    if (userRole !== 'STUDENT' || lastReadCursorRef.current === cursor || readingCursorRef.current === cursor) return;
    readingCursorRef.current = cursor;
    try {
      const response = await fetch('/api/announcements/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ through: cursor }),
      });
      if (!response.ok) throw new Error('MARK_ANNOUNCEMENTS_READ_FAILED');
      lastReadCursorRef.current = cursor;
      onRead?.();
    } catch (readError) {
      console.error('Announcement read state update failed:', readError);
      onUnread?.();
      setError(language === 'en'
        ? 'Announcements loaded, but the unread status could not be updated.'
        : 'お知らせは表示できましたが、未読状態を更新できませんでした。');
    } finally {
      if (readingCursorRef.current === cursor) readingCursorRef.current = null;
    }
  }, [language, onRead, onUnread, userRole]);

  const tryMarkCurrentRead = useCallback(() => {
    if (userRole !== 'STUDENT' || !isViewingLatest()) return false;
    const cursor = readCursorRef.current;
    if (cursor) void markReadThrough(cursor);
    else onRead?.();
    return true;
  }, [isViewingLatest, markReadThrough, onRead, userRole]);

  const loadAnnouncements = useCallback(async (append = false, options: LoadOptions = {}) => {
    const requestSequence = ++loadSequenceRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    try {
      const before = append ? announcementsRef.current.at(-1)?.id : undefined;
      const response = await fetch(`/api/announcements${before ? `?before=${encodeURIComponent(before)}` : ''}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (requestSequence !== loadSequenceRef.current) return;
      if (!response.ok) throw new Error(data.error || 'LOAD_FAILED');
      const next = Array.isArray(data.announcements) ? data.announcements as AnnouncementItem[] : [];
      setAnnouncements((current) => {
        if (!append) {
          announcementsRef.current = next;
          return next;
        }
        const ids = new Set(current.map((item) => item.id));
        const merged = [...current, ...next.filter((item) => !ids.has(item.id))];
        announcementsRef.current = merged;
        return merged;
      });
      setHasMore(Boolean(data.hasMore));

      if (!append) {
        readCursorRef.current = typeof data.readCursor === 'string' ? data.readCursor : null;
      }

      if (!append && userRole === 'STUDENT' && options.markReadIfViewed) {
        let viewed = isViewingLatest();
        if (viewed) {
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          viewed = tryMarkCurrentRead();
        }
        if (!viewed && options.signalUnreadIfNotViewed) onUnread?.();
      }
    } catch (loadError) {
      if (requestSequence !== loadSequenceRef.current) return;
      console.error('Announcement load failed:', loadError);
      setError(language === 'en' ? 'Could not load announcements.' : 'お知らせを読み込めませんでした。');
      if (options.signalUnreadIfNotViewed) onUnread?.();
    } finally {
      if (requestSequence === loadSequenceRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [isViewingLatest, language, onUnread, tryMarkCurrentRead, userRole]);

  const loadRef = useRef(loadAnnouncements);
  useEffect(() => {
    loadRef.current = loadAnnouncements;
  }, [loadAnnouncements]);

  useEffect(() => {
    void loadRef.current(false, { markReadIfViewed: true, signalUnreadIfNotViewed: true });
    const socket = getSocket();
    const handleUpdate = (update: AnnouncementUpdatedPayload) => {
      const carriesUnread = update.reason === 'created' || update.reason === 'updated';
      void loadRef.current(false, {
        markReadIfViewed: carriesUnread,
        signalUnreadIfNotViewed: carriesUnread,
      });
    };
    const handleAppNotification = (notification: AppNotificationPayload) => {
      if (notification.kind !== 'announcement') return;
      void loadRef.current(false, {
        markReadIfViewed: true,
        signalUnreadIfNotViewed: true,
      });
    };
    socket.on('announcements_updated', handleUpdate);
    socket.on('app_notification', handleAppNotification);
    return () => {
      socket.off('announcements_updated', handleUpdate);
      socket.off('app_notification', handleAppNotification);
    };
  }, []);

  useEffect(() => {
    if (targetScrolledRef.current || loading) return;
    const targetId = new URLSearchParams(window.location.search).get('announcement');
    if (!targetId) return;
    const requested = document.getElementById(`announcement-${targetId}`);
    const latest = announcements[0]
      ? document.getElementById(`announcement-${announcements[0].id}`)
      : null;
    const target = requested || latest;
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('announcement-card--target');
      window.setTimeout(() => target.classList.remove('announcement-card--target'), 2200);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('announcement');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    targetScrolledRef.current = true;
  }, [announcements, loading]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') tryMarkCurrentRead();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [tryMarkCurrentRead]);

  const publish = async () => {
    if (!draft.trim() || publishing) return;
    setPublishing(true);
    setError('');
    try {
      const response = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'PUBLISH_FAILED');
      setDraft('');
      setShowPreview(false);
      await loadRef.current(false);
    } catch (publishError) {
      console.error('Announcement publish failed:', publishError);
      setError(language === 'en' ? 'Could not publish the announcement.' : '全体告知を投稿できませんでした。');
    } finally {
      setPublishing(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editValue.trim() || savingId) return;
    setSavingId(id);
    try {
      const response = await fetch(`/api/announcements/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editValue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'UPDATE_FAILED');
      setEditingId(null);
      setEditValue('');
      await loadRef.current(false);
    } catch (saveError) {
      console.error('Announcement update failed:', saveError);
      setError(language === 'en' ? 'Could not update the announcement.' : '全体告知を更新できませんでした。');
    } finally {
      setSavingId(null);
    }
  };

  const removeAnnouncement = async (id: string) => {
    const confirmed = window.confirm(language === 'en' ? 'Delete this announcement?' : 'この全体告知を削除しますか？');
    if (!confirmed) return;
    setSavingId(id);
    try {
      const response = await fetch(`/api/announcements/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('DELETE_FAILED');
      setAnnouncements((current) => {
        const next = current.filter((item) => item.id !== id);
        announcementsRef.current = next;
        return next;
      });
    } catch (deleteError) {
      console.error('Announcement delete failed:', deleteError);
      setError(language === 'en' ? 'Could not delete the announcement.' : '全体告知を削除できませんでした。');
    } finally {
      setSavingId(null);
    }
  };

  const toggleReaction = async (id: string, emoji: string) => {
    const key = `${id}:${emoji}`;
    if (reactingKey) return;
    setReactingKey(key);
    try {
      const response = await fetch(`/api/announcements/${encodeURIComponent(id)}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (!response.ok) throw new Error('REACTION_FAILED');
      await loadRef.current(false);
    } catch (reactionError) {
      console.error('Announcement reaction failed:', reactionError);
      setError(language === 'en' ? 'Could not update your reaction.' : 'リアクションを更新できませんでした。');
    } finally {
      setReactingKey(null);
    }
  };

  const addFormat = (template: string) => {
    setDraft((current) => current ? `${current}\n${template}` : template);
  };

  return (
    <div
      className="announcements-view"
      ref={viewRef}
      onScroll={() => { tryMarkCurrentRead(); }}
    >
      {userRole === 'TEACHER' && (
        <section className="announcement-composer">
          <div className="announcement-composer__heading">
            <div>
              <h2>{language === 'en' ? 'Post to every student' : '全生徒へ告知する'}</h2>
              <p>{language === 'en' ? 'Students can read and react with emoji, but cannot reply.' : '生徒は閲覧と絵文字リアクションだけでき、文章では返信できません。'}</p>
            </div>
            <IconMegaphone size={28} />
          </div>
          <div className="announcement-format-bar" aria-label={language === 'en' ? 'Formatting shortcuts' : '文字装飾のショートカット'}>
            <button type="button" onClick={() => addFormat(language === 'en' ? '# Large heading' : '# 大きな見出し')}>{language === 'en' ? '# Large' : '# 大'}</button>
            <button type="button" onClick={() => addFormat(language === 'en' ? '## Heading' : '## 見出し')}>{language === 'en' ? '## Medium' : '## 中'}</button>
            <button type="button" onClick={() => addFormat(language === 'en' ? '### Small heading' : '### 小見出し')}>{language === 'en' ? '### Small' : '### 小'}</button>
            <button type="button" onClick={() => addFormat(language === 'en' ? '-# Supporting note' : '-# 小さな補足文')}>{language === 'en' ? '-# Note' : '-# 補足'}</button>
            <button type="button" onClick={() => addFormat(language === 'en' ? '**Bold text**' : '**太字**')}><strong>B</strong></button>
            <button type="button" onClick={() => addFormat(language === 'en' ? '- List item' : '- 箇条書き')}>{language === 'en' ? '• List' : '・リスト'}</button>
            <button type="button" className={showPreview ? 'active' : ''} onClick={() => setShowPreview((value) => !value)}>
              {language === 'en' ? 'Preview' : 'プレビュー'}
            </button>
          </div>
          <div className={`announcement-composer__body ${showPreview ? 'with-preview' : ''}`}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={10_000}
              rows={7}
              placeholder={language === 'en' ? 'Write an announcement...' : '全生徒へのお知らせを書いてください…'}
            />
            {showPreview && (
              <div className="announcement-preview">
                <div className="announcement-preview__label">{language === 'en' ? 'Preview' : '表示プレビュー'}</div>
                {draft.trim() ? <MarkdownContent content={draft} /> : <p className="announcement-preview__empty">{language === 'en' ? 'Your preview appears here.' : 'ここにプレビューが表示されます。'}</p>}
              </div>
            )}
          </div>
          <div className="announcement-composer__footer">
            <span>{draft.length.toLocaleString()} / 10,000</span>
            <button type="button" className="announcement-publish-btn" onClick={publish} disabled={!draft.trim() || publishing}>
              <IconSend size={16} /> {publishing ? (language === 'en' ? 'Publishing...' : '投稿中…') : (language === 'en' ? 'Publish' : '全生徒へ投稿')}
            </button>
          </div>
        </section>
      )}

      {error && <div className="announcements-error">{error}</div>}

      <div className="announcements-feed">
        {loading && announcements.length === 0 ? (
          <div className="announcements-empty">{language === 'en' ? 'Loading announcements...' : 'お知らせを読み込み中です…'}</div>
        ) : announcements.length === 0 ? (
          <div className="announcements-empty">
            <IconMegaphone size={42} />
            <h2>{language === 'en'
              ? (userRole === 'TEACHER' ? 'No global announcements yet' : 'No announcements yet')
              : (userRole === 'TEACHER' ? 'まだ全体告知はありません' : 'まだお知らせはありません')}</h2>
            <p>{language === 'en'
              ? (userRole === 'TEACHER' ? 'Use the editor above to post the first announcement.' : 'Announcements from your teacher will appear here.')
              : (userRole === 'TEACHER' ? '上の入力欄から、最初のお知らせを投稿できます。' : '先生からのお知らせが届くと、ここに表示されます。')}</p>
          </div>
        ) : (
          announcements.map((announcement) => (
            <article className="announcement-card" id={`announcement-${announcement.id}`} key={announcement.id}>
              <header className="announcement-card__header">
                <div className="announcement-card__author">
                  <span className="announcement-card__avatar">{announcement.teacher.name.slice(0, 1)}</span>
                  <div>
                    <strong>{announcement.teacher.name}</strong>
                    <div>
                      {formatAnnouncementDate(announcement.createdAt, language)}
                      {announcement.isEdited && <span> · {language === 'en' ? 'edited' : '編集済み'}</span>}
                    </div>
                  </div>
                </div>
                {userRole === 'TEACHER' && editingId !== announcement.id && (
                  <div className="announcement-card__actions">
                    <button type="button" onClick={() => { setEditingId(announcement.id); setEditValue(announcement.content); }} title={language === 'en' ? 'Edit' : '編集'} aria-label={language === 'en' ? 'Edit announcement' : 'お知らせを編集'}>
                      <IconPencil size={15} />
                    </button>
                    <button type="button" onClick={() => void removeAnnouncement(announcement.id)} disabled={savingId === announcement.id} title={language === 'en' ? 'Delete' : '削除'} aria-label={language === 'en' ? 'Delete announcement' : 'お知らせを削除'}>
                      <IconTrash2 size={15} />
                    </button>
                  </div>
                )}
              </header>

              {editingId === announcement.id ? (
                <div className="announcement-edit">
                  <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} maxLength={10_000} rows={6} />
                  <div className="announcement-edit__actions">
                    <button type="button" onClick={() => { setEditingId(null); setEditValue(''); }}><IconX size={14} /> {language === 'en' ? 'Cancel' : 'キャンセル'}</button>
                    <button type="button" className="primary" onClick={() => void saveEdit(announcement.id)} disabled={!editValue.trim() || savingId === announcement.id}>
                      {language === 'en' ? 'Save' : '保存'}
                    </button>
                  </div>
                </div>
              ) : (
                <MarkdownContent content={announcement.content} />
              )}

              <div className="announcement-reactions">
                {userRole === 'STUDENT' ? (
                  ANNOUNCEMENT_REACTIONS.map((emoji) => {
                    const group = announcement.reactions.find((reaction) => reaction.emoji === emoji);
                    const active = announcement.currentUserEmojis.includes(emoji);
                    return (
                      <button
                        type="button"
                        className={active ? 'active' : ''}
                        onClick={() => void toggleReaction(announcement.id, emoji)}
                        disabled={reactingKey !== null}
                        aria-pressed={active}
                        key={emoji}
                      >
                        <span>{emoji}</span>{group?.count ? <strong>{group.count}</strong> : null}
                      </button>
                    );
                  })
                ) : announcement.reactions.length > 0 ? (
                  announcement.reactions.map((reaction) => (
                    <details className="announcement-reaction-summary" key={reaction.emoji}>
                      <summary><span>{reaction.emoji}</span><strong>{reaction.count}</strong></summary>
                      <div>{reaction.students.map((student) => student.name).join('、')}</div>
                    </details>
                  ))
                ) : (
                  <span className="announcement-reactions__none">{language === 'en' ? 'No reactions yet' : 'まだリアクションはありません'}</span>
                )}
              </div>
            </article>
          ))
        )}

        {hasMore && (
          <button type="button" className="announcements-load-more" onClick={() => void loadAnnouncements(true)} disabled={loadingMore}>
            {loadingMore ? (language === 'en' ? 'Loading...' : '読み込み中…') : (language === 'en' ? 'Load older announcements' : '過去のお知らせを読み込む')}
          </button>
        )}
      </div>
    </div>
  );
}
