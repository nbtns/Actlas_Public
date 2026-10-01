'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IconX, IconChevronRight, IconChevronLeft, IconCalendar, IconBan } from '../Icons';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { getSocket, type ScheduleUpdatedPayload } from '@/lib/socket';
import { getReservationErrorMessage } from '@/lib/reservation-messages';

// ===== 定数 =====
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const SLOT_INTERVAL = 15;

// ===== 型定義 =====
interface Reservation {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  student: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  createdAt: string;
}

interface BlockedSlot {
  id: string;
  startTime: string;
  endTime: string;
  reason: string | null;
}

// ===== ヘルパー関数 =====
/** 日付をタイムゾーンの "YYYY-MM-DD" 形式にフォーマット */
function toDateStrTZ(date: Date | string | number, tz: string): string {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

/** 週の開始日（月曜日）を取得 */
function getWeekStartTZ(date: Date | string | number, tz: string): Date {
  const d = toZonedTime(date, tz);
  const day = d.getDay();
  // 月曜を週の開始とする（日曜=0 → 6日前、月曜=1 → 0日前、...）
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 週の7日間を取得 */
function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

/** 時刻をフォーマット */
function formatTimeTZ(date: Date | string | number, tz: string): string {
  return formatInTimeZone(date, tz, 'HH:mm');
}

/** 16進数カラーコードをRGB文字列に変換 */
function hexToRgb(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
}

// ===== メインコンポーネント =====
export default function TeacherBookingView({ language = 'ja', timezone = 'Asia/Tokyo' }: { language?: string, timezone?: string }) {
  const tz = timezone || 'Asia/Tokyo';
  const nowZoned = toZonedTime(new Date(), tz);
  const [weekStart, setWeekStart] = useState(() => getWeekStartTZ(new Date(), tz));
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [revealedCancelId, setRevealedCancelId] = useState<string | null>(null);
  const cancelRevealTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockDate, setBlockDate] = useState<Date | null>(null);
  const [blockTimes, setBlockTimes] = useState<string[]>([]);
  const [initialBlocks, setInitialBlocks] = useState<BlockedSlot[]>([]);
  const [blockSaveError, setBlockSaveError] = useState('');
  const [blockSaving, setBlockSaving] = useState(false);

  const tzTimeSlots = React.useMemo(() => {
    // ブロック対象日のJST7:00〜14:00の枠を現在のtzに変換
    const baseDateStr = toDateStrTZ(blockDate ?? weekStart, tz);
    const baseNoonUTC = fromZonedTime(`${baseDateStr}T12:00:00`, tz);
    const jstDateStr = formatInTimeZone(baseNoonUTC, 'Asia/Tokyo', 'yyyy-MM-dd');
    const slots: string[] = [];
    for (let h = 7; h <= 14; h++) {
      for (let m = 0; m < 60; m += SLOT_INTERVAL) {
        if (h === 14 && m > 0) break;
        const slotUTC = fromZonedTime(`${jstDateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`, 'Asia/Tokyo');
        slots.push(formatInTimeZone(slotUTC, tz, 'HH:mm'));
      }
    }
    return slots;
  }, [tz, blockDate, weekStart]);

  // 時間帯（1時間ごと）のラベル生成（JST 7:00 が現在の tz で何時になるかを計算して 8時間分）
  const hourLabels = React.useMemo(() => {
    const baseDateStr = toDateStrTZ(weekStart, tz);
    const baseNoonUTC = fromZonedTime(`${baseDateStr}T12:00:00`, tz);
    const jstDateStr = formatInTimeZone(baseNoonUTC, 'Asia/Tokyo', 'yyyy-MM-dd');
    const jst7UTC = fromZonedTime(`${jstDateStr}T07:00:00`, 'Asia/Tokyo');
    const tzHour = toZonedTime(jst7UTC, tz).getHours();
    return Array.from({ length: 8 }, (_, i) => (tzHour + i) % 24);
  }, [tz, weekStart]);

  useEffect(() => {
    if (!blockDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialBlocks([]);
      setBlockTimes([]);
      return;
    }
    
    // blockDate（ローカル時間のDate）からtz基準の日付文字列を作成
    const dateStr = toDateStrTZ(blockDate, tz);
    const startHour = hourLabels[0];
    
    // この日に属するブロックを探す（日またぎ対応）
    const dayBlocked = blockedSlots.filter(b => {
      const bStartZoned = toZonedTime(b.startTime, tz);
      let bDateStr = formatInTimeZone(bStartZoned, tz, 'yyyy-MM-dd');
      
      // もしブロック時間が翌日の午前中などに日またぎしている場合、それを元の日の枠として扱う
      const bHour = bStartZoned.getHours();
      if (bHour < startHour || (startHour === 0 && bHour === 0 && tzTimeSlots.indexOf(formatInTimeZone(bStartZoned, tz, 'HH:mm')) > 0)) {
        // bDateStr の1日前に戻す
        const bDate = new Date(bDateStr + 'T00:00:00');
        bDate.setDate(bDate.getDate() - 1);
        bDateStr = toDateStrTZ(bDate, tz);
      }
      
      return bDateStr === dateStr;
    });
    
    setInitialBlocks(dayBlocked);
    setBlockTimes(dayBlocked.map(b => formatTimeTZ(b.startTime, tz)));
  }, [blockDate, blockedSlots, tz, hourLabels, tzTimeSlots]);

  const weekDays = getWeekDays(weekStart);

  // データ取得（週の前後に余裕を持って取得）
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 週の最初の月と最後の月をカバー
      const months = new Set<string>();
      weekDays.forEach(d => {
        [-1, 0, 1].forEach(offset => {
          const monthDate = new Date(Date.UTC(d.getFullYear(), d.getMonth() + offset, 1));
          months.add(`${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, '0')}`);
        });
      });

      // 各月分のデータを取得
      const allReservations: Reservation[] = [];
      const allBlocked: BlockedSlot[] = [];

      for (const month of months) {
        const [resRes, blockedRes] = await Promise.all([
          fetch(`/api/reservations?month=${month}`),
          fetch(`/api/blocked-slots?month=${month}`),
        ]);

        const resData = await resRes.json();
        const blockedData = await blockedRes.json();

        if (resData.reservations) allReservations.push(...resData.reservations);
        if (blockedData.blockedSlots) allBlocked.push(...blockedData.blockedSlots);
      }

      // 重複排除（月をまたぐ場合）
      const uniqueRes = Array.from(new Map(allReservations.map(r => [r.id, r])).values());
      const uniqueBlocked = Array.from(new Map(allBlocked.map(b => [b.id, b])).values());

      setReservations(uniqueRes);
      setBlockedSlots(uniqueBlocked);
    } catch {
      console.error('データ取得エラー');
    } finally {
      setLoading(false);
    }
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const socket = getSocket();
    const handleScheduleUpdated = (_data: ScheduleUpdatedPayload) => {
      void fetchData();
    };

    socket.on('schedule_updated', handleScheduleUpdated);
    return () => {
      socket.off('schedule_updated', handleScheduleUpdated);
    };
  }, [fetchData]);

  useEffect(() => {
    return () => {
      if (cancelRevealTimerRef.current) clearTimeout(cancelRevealTimerRef.current);
    };
  }, []);

  const clearCancelRevealTimer = () => {
    if (cancelRevealTimerRef.current) {
      clearTimeout(cancelRevealTimerRef.current);
      cancelRevealTimerRef.current = null;
    }
  };

  const startCancelRevealTimer = (reservationId: string) => {
    clearCancelRevealTimer();
    cancelRevealTimerRef.current = setTimeout(() => {
      setRevealedCancelId(reservationId);
      cancelRevealTimerRef.current = null;
    }, 550);
  };

  // 週の前後移動
  const currentWeekStart = getWeekStartTZ(new Date(), tz);
  const isCurrentWeek = weekStart.getTime() <= currentWeekStart.getTime();

  const prevWeek = () => {
    if (isCurrentWeek) return;
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };
  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };
  const goToday = () => {
    setWeekStart(getWeekStartTZ(new Date(), tz));
  };

  // 日またぎ対応のため予約取得は使わないので削除
  // const getReservationsForDate = ...
  // const getBlockedForDate = ...

  // 予約キャンセル
  const handleCancel = async (reservationId: string) => {
    if (!confirm(language === 'en' ? 'Cancel this reservation?' : 'この予約をキャンセルしますか？')) return;
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      console.error('キャンセルエラー');
    }
  };

  // ブロック設定保存
  const handleSaveBlocks = async () => {
    if (!blockDate) return;

    setBlockSaving(true);
    setBlockSaveError('');
    try {
      const initialTimesSet = new Set(initialBlocks.map(b => formatTimeTZ(b.startTime, tz)));

      const additions = blockTimes.filter(t => !initialTimesSet.has(t));
      const deletions = initialBlocks.filter(b => {
        const t = formatTimeTZ(b.startTime, tz);
        return !blockTimes.includes(t);
      });

      const promises = [];

      for (const time of additions) {
        const dateStr = toDateStrTZ(blockDate, tz);
        const [h] = time.split(':').map(Number);
        const startHour = hourLabels[0];
        
        const tzDate = new Date(dateStr + 'T00:00:00');
        // 時間が開始時間より小さければ日またぎとみなして日付を+1
        if (h < startHour || (startHour === 0 && h === 0 && time !== tzTimeSlots[0])) {
           tzDate.setDate(tzDate.getDate() + 1);
        }
        
        const tzDateStr = `${toDateStrTZ(tzDate, tz)}T${time}:00`;
        const start = fromZonedTime(tzDateStr, tz);
        const end = new Date(start);
        end.setMinutes(end.getMinutes() + SLOT_INTERVAL);

        promises.push(fetch('/api/blocked-slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            reason: 'スケジュールブロック',
          }),
        }));
      }

      for (const b of deletions) {
        promises.push(fetch(`/api/blocked-slots?id=${b.id}`, {
          method: 'DELETE',
        }));
      }

      const responses = await Promise.all(promises);
      const failedResponse = responses.find(res => !res.ok);
      if (failedResponse) {
        const data = await failedResponse.json().catch(() => ({}));
        throw new Error(getReservationErrorMessage(data.errorCode, language, 'BLOCK_CREATE_FAILED', data.error));
      }

      await fetchData();
      setShowBlockModal(false);
      setBlockDate(null);
      setBlockTimes([]);
    } catch (error) {
      console.error('ブロック設定エラー', error);
      setBlockSaveError(
        error instanceof Error
          ? error.message
          : (language === 'en' ? 'Could not save blocks.' : 'ブロック設定を保存できませんでした。')
      );
    } finally {
      setBlockSaving(false);
    }
  };

  // 今日の日付文字列
  const todayStr = toDateStrTZ(nowZoned, tz);

  // 週の範囲を表示用にフォーマット
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = language === 'en' ? `${weekStart.getMonth() + 1}/${weekStart.getDate()} - ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}` : `${weekStart.getMonth() + 1}月${weekStart.getDate()}日〜${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;

  const getDayWindow = (day: Date) => {
    const dateStr = toDateStrTZ(day, tz);
    const dayStartUTC = fromZonedTime(`${dateStr}T${String(hourLabels[0]).padStart(2, '0')}:00:00`, tz).getTime();
    const dayEndUTC = dayStartUTC + 8 * 60 * 60 * 1000;
    return { dateStr, dayStartUTC, dayEndUTC };
  };

  return (
    <div className="tbv">
      {/* ===== ヘッダー ===== */}
      <div className="tbv__header">
        <div className="tbv__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <IconCalendar size={18} /> {language === 'en' ? 'Manage Reservations' : '予約管理'}
        </div>
        <div className="tbv__actions">
          <button className="tbv__block-btn" style={{ display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => {
            setBlockDate(new Date());
            setBlockSaveError('');
            setShowBlockModal(true);
          }}>
            <IconBan size={14} /> {language === 'en' ? 'Block Time Slots' : '時間帯をブロック'}
          </button>
        </div>
      </div>

      {/* ===== 週ナビゲーション ===== */}
      <div className="tbv__nav">
        <button className="tbv__nav-btn" onClick={prevWeek} disabled={isCurrentWeek}><IconChevronLeft size={16} /></button>
        <button className="tbv__nav-today" onClick={goToday}>{language === 'en' ? 'Today' : '今日'}</button>
        <span className="tbv__nav-label">{weekLabel}</span>
        <button className="tbv__nav-btn" onClick={nextWeek}><IconChevronRight size={16} /></button>
      </div>

      {/* ===== 週間タイムライン ===== */}
      <div className="tbv__timeline">
        {loading && (
          <div className="tbv__loading">
            <div className="login-form__spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
          </div>
        )}

        {/* 時間ラベル列 + 7日分 */}
        <div className="tbv__grid">
          {/* ヘッダー行: 空 + 7日分の日付 */}
          <div className="tbv__grid-header">
            <div className="tbv__grid-corner" />
            {weekDays.map(day => {
              const dateStr = toDateStrTZ(day, tz);
              const isToday = dateStr === todayStr;
              
              // その日のカレンダー列に表示すべき予約件数（UTCでの絶対時間で判定）
              const dayStartUTC = fromZonedTime(`${dateStr}T${String(hourLabels[0]).padStart(2, '0')}:00:00`, tz).getTime();
              const dayEndUTC = dayStartUTC + 8 * 60 * 60 * 1000; // 8時間分
              const dayReservations = reservations.filter(r => {
                const rStartUTC = new Date(r.startTime).getTime();
                return rStartUTC >= dayStartUTC && rStartUTC < dayEndUTC && r.status !== 'CANCELLED';
              });
              
              return (
                <div
                  key={dateStr}
                  className={`tbv__grid-day-header ${isToday ? 'tbv__grid-day-header--today' : ''}`}
                >
                  <span className="tbv__grid-day-weekday">{(language === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : WEEKDAYS)[day.getDay()]}</span>
                  <span className="tbv__grid-day-date">{day.getDate()}</span>
                  {dayReservations.length > 0 && (
                    <span className="tbv__grid-day-count">{dayReservations.length}{language === 'en' ? '' : '件'}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 時間帯行 */}
          {hourLabels.map((hour, idx) => (
            <div key={hour} className="tbv__grid-row">
              <div className="tbv__grid-time">{hour}:00</div>
              {weekDays.map(day => {
                const dateStr = toDateStrTZ(day, tz);
                
                // --- セルの絶対時間を計算 ---
                const startHour = hourLabels[0];
                let isNextDay = false;
                if (hour < startHour || (startHour === 0 && hour === 0 && idx > 0)) {
                   isNextDay = true;
                }
                
                const cellStartStr = `${dateStr}T${String(hour).padStart(2, '0')}:00:00`;
                let cellStartUTC = fromZonedTime(cellStartStr, tz).getTime();
                if (isNextDay) {
                  cellStartUTC += 24 * 60 * 60 * 1000;
                }
                const cellEndUTC = cellStartUTC + 60 * 60 * 1000;

                // この時間帯に重なる予約を取得（UTC比較）
                const hourReservations = reservations.filter(r => {
                  const rStartUTC = new Date(r.startTime).getTime();
                  const rEndUTC = new Date(r.endTime).getTime();
                  return rStartUTC < cellEndUTC && rEndUTC > cellStartUTC && r.status !== 'CANCELLED';
                });

                // ブロック時間帯があるか（UTC比較）
                const isBlocked = blockedSlots.some(b => {
                  const bStartUTC = new Date(b.startTime).getTime();
                  const bEndUTC = new Date(b.endTime).getTime();
                  return bStartUTC < cellEndUTC && bEndUTC > cellStartUTC;
                });

                return (
                  <div
                    key={dateStr}
                    className={`tbv__grid-cell ${isBlocked ? 'tbv__grid-cell--blocked' : ''}`}
                  >
                    {hourReservations.map(r => {
                      const rStartUTC = new Date(r.startTime).getTime();
                      // 予約の開始時間がこの時間帯セルの場合のみカードを表示（重複表示を防ぐ）
                      if (rStartUTC < cellStartUTC || rStartUTC >= cellEndUTC) return null;

                      // 開始位置と高さの計算
                      const rStartZoned = toZonedTime(r.startTime, tz);
                      const startMin = rStartZoned.getMinutes();
                      const durationMin = (new Date(r.endTime).getTime() - rStartUTC) / (60 * 1000);

                      const avatarColor = r.student.avatarUrl?.split(':')[0] || '#FF6A36';
                      const rgbColor = hexToRgb(avatarColor) || '255, 106, 54'; // デフォルトはオレンジのRGB

                      return (
                        <div
                          key={r.id}
                          className="tbv__reservation-card"
                          style={{
                            top: `calc(${(startMin / 60) * 100}% + 2px)`,
                            height: `calc(${(durationMin / 60) * 100}% - 4px)`,
                            backgroundColor: `rgba(${rgbColor}, 0.15)`,
                            borderColor: `rgba(${rgbColor}, 0.3)`,
                            borderLeftColor: avatarColor,
                          }}
                        >
                          <div className="tbv__reservation-time">
                            {formatTimeTZ(r.startTime, tz)}〜{formatTimeTZ(r.endTime, tz)}
                          </div>
                          <div className="tbv__reservation-student" style={{ color: '#fff' }}>
                            {r.student.name}
                          </div>
                          {r.notes && (
                            <div className="tbv__reservation-notes">{r.notes}</div>
                          )}
                          <button
                            className="tbv__reservation-cancel"
                            onClick={() => handleCancel(r.id)}
                            title={language === 'en' ? 'Cancel' : 'キャンセル'}
                          >
                            <IconX size={12} />
                          </button>
                        </div>
                      );
                    })}
                    {isBlocked && hourReservations.length === 0 && (
                      <div className="tbv__blocked-label">{language === 'en' ? 'Blocked' : 'ブロック'}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="tbv__mobile-list">
          {weekDays.map(day => {
            const { dateStr, dayStartUTC, dayEndUTC } = getDayWindow(day);
            const isToday = dateStr === todayStr;
            const dayReservations = reservations
              .filter(r => {
                const rStartUTC = new Date(r.startTime).getTime();
                return rStartUTC >= dayStartUTC && rStartUTC < dayEndUTC && r.status !== 'CANCELLED';
              })
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
            const dayBlockedSlots = blockedSlots
              .filter(b => {
                const bStartUTC = new Date(b.startTime).getTime();
                const bEndUTC = new Date(b.endTime).getTime();
                return bStartUTC < dayEndUTC && bEndUTC > dayStartUTC;
              })
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

            return (
              <section key={dateStr} className={`tbv__mobile-day ${isToday ? 'tbv__mobile-day--today' : ''}`}>
                <div className="tbv__mobile-day-header">
                  <span>{(language === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : WEEKDAYS)[day.getDay()]}</span>
                  <strong>{formatInTimeZone(day, tz, language === 'en' ? 'M/d' : 'M月d日')}</strong>
                  {dayReservations.length > 0 && (
                    <span className="tbv__mobile-day-count">{dayReservations.length}{language === 'en' ? '' : '件'}</span>
                  )}
                </div>

                {dayReservations.length === 0 && dayBlockedSlots.length === 0 ? (
                  <div className="tbv__mobile-empty">{language === 'en' ? 'No schedule' : '予定なし'}</div>
                ) : (
                  <div className="tbv__mobile-day-body">
                    {dayReservations.map(r => (
                      <div
                        key={r.id}
                        className={`tbv__mobile-reservation ${revealedCancelId === r.id ? 'tbv__mobile-reservation--cancel-visible' : ''}`}
                        onPointerDown={event => {
                          if (event.pointerType === 'touch') startCancelRevealTimer(r.id);
                        }}
                        onPointerUp={clearCancelRevealTimer}
                        onPointerCancel={clearCancelRevealTimer}
                        onPointerLeave={clearCancelRevealTimer}
                      >
                        <div className="tbv__mobile-reservation-main">
                          <div className="tbv__mobile-reservation-time">
                            {formatTimeTZ(r.startTime, tz)}〜{formatTimeTZ(r.endTime, tz)}
                          </div>
                          <div className="tbv__mobile-reservation-student">{r.student.name}</div>
                          {r.notes && <div className="tbv__mobile-reservation-notes">{r.notes}</div>}
                        </div>
                        <button
                          className="tbv__mobile-reservation-cancel"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRevealedCancelId(null);
                            handleCancel(r.id);
                          }}
                          title={language === 'en' ? 'Cancel' : 'キャンセル'}
                        >
                          <IconX size={14} />
                        </button>
                      </div>
                    ))}

                    {dayBlockedSlots.map(slot => (
                      <div key={slot.id} className="tbv__mobile-blocked">
                        <span>{formatTimeTZ(slot.startTime, tz)}〜{formatTimeTZ(slot.endTime, tz)}</span>
                        <strong>{language === 'en' ? 'Blocked' : 'ブロック'}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* ===== ブロック設定モーダル ===== */}
      {showBlockModal && (
        <div className="modal-overlay" onClick={() => setShowBlockModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal__header">{language === 'en' ? 'Block Time Slots' : '時間帯をブロック'}</div>
            <div className="modal__body">
              <label className="modal__label">
                {language === 'en' ? 'Date' : '日付'}
                <input
                  className="modal__input"
                  type="date"
                  value={blockDate ? toDateStrTZ(blockDate, tz) : ''}
                  onChange={e => {
                    // 入力された日付文字列をTZ基準として解釈する
                    const tzDateStr = `${e.target.value}T00:00:00`;
                    setBlockDate(fromZonedTime(tzDateStr, tz));
                  }}
                />
              </label>

              <div className="modal__label">
                {language === 'en' ? 'Time Slots to Block (Multiple Selectable)' : 'ブロックする時間帯（複数選択可能）'}
                <div className="booking-block-times">
                  {tzTimeSlots.map(time => (
                    <button
                      key={time}
                      className={`booking-block-time-btn ${blockTimes.includes(time) ? 'active' : ''}`}
                      onClick={() => {
                        setBlockTimes(prev =>
                          prev.includes(time)
                            ? prev.filter(t => t !== time)
                            : [...prev, time]
                        );
                      }}
                    >
                      {time}
                    </button>
                  ))}
                </div>
              </div>
              {blockSaveError && (
                <div className="booking-confirm__error" style={{ marginTop: 14 }}>
                  {blockSaveError}
                </div>
              )}
            </div>
            <div className="modal__footer modal__footer--block">
              <button
                className="modal__btn modal__btn--allday"
                onClick={() => {
                  if (blockTimes.length === tzTimeSlots.length) {
                    setBlockTimes([]);
                  } else {
                    setBlockTimes([...tzTimeSlots]);
                  }
                }}
              >
                {blockTimes.length === tzTimeSlots.length ? (language === 'en' ? 'Clear All' : '全解除') : (language === 'en' ? 'Block All Day' : '全日ブロック')}
              </button>
              <div className="modal__footer-actions">
                <button className="modal__btn modal__btn--cancel" onClick={() => {
                  setBlockSaveError('');
                  setShowBlockModal(false);
                }} disabled={blockSaving}>
                  {language === 'en' ? 'Cancel' : 'キャンセル'}
                </button>
                <button className="modal__btn modal__btn--submit" onClick={handleSaveBlocks} disabled={blockSaving}>
                  {blockSaving
                    ? (language === 'en' ? 'Saving...' : '保存中...')
                    : (language === 'en' ? 'Save Blocks' : 'ブロック設定')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
