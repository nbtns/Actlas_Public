'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IconX, IconChevronRight } from '../Icons';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { addMinutes } from 'date-fns';
import { ja, enUS } from 'date-fns/locale';
import { getSocket, type ScheduleUpdatedPayload } from '@/lib/socket';
import { getReservationErrorMessage } from '@/lib/reservation-messages';

// ===== 定数 =====
/** デフォルトのレッスン1回の時間（分） */
const DEFAULT_LESSON_DURATION = 60;

/** 時間帯のスロット間隔（分） */
const SLOT_INTERVAL = 15;

/** 予約前後に必要な休憩時間（分）。API側のBUFFER_MINUTESと合わせる */
const BUFFER_MINUTES = 15;

/** 曜日ラベル */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// 先生の基本タイムゾーン（固定）
const TEACHER_TZ = 'Asia/Tokyo';

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

interface BusySlot {
  startTime: string;
  endTime: string;
}

interface LessonMenu {
  id: string;
  name: string;
  description: string | null;
  price: number;
  standardPrice?: number;
  specialPriceApplied?: boolean;
  duration: number;
}

interface AvailableSlot {
  startTimeUTC: Date;
  displayTime: string;
  timeKey: string;
}

interface BookingViewProps {
  /** 現在のユーザーのロール */
  userRole: 'TEACHER' | 'STUDENT';
  /** 現在のルームID（先生が生徒の予約を見る場合に使用） */
  roomId?: string;
  /** 言語設定 */
  language?: string;
  /** タイムゾーン */
  timezone?: string;
}

// ===== ヘルパー関数 =====

/** 日付をタイムゾーンの "YYYY-MM-DD" 形式にフォーマット */
function toDateStrTZ(date: Date | string | number, tz: string): string {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

/** 日付を "M月D日（曜日）" 形式にフォーマット */
function formatDateJPTZ(date: Date | string | number, tz: string, language = 'ja'): string {
  if (language === 'en') {
    return formatInTimeZone(date, tz, 'M/d (E)', { locale: enUS });
  }
  return formatInTimeZone(date, tz, 'M月d日（E）', { locale: ja });
}

/** 時刻を "HH:mm" 形式にフォーマット */
function formatTimeTZ(date: Date | string | number, tz: string): string {
  return formatInTimeZone(date, tz, 'HH:mm');
}

function shiftDateStr(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getAdjacentMonthStrings(year: number, monthIndex: number): string[] {
  return [-1, 0, 1].map(offset => {
    const date = new Date(Date.UTC(year, monthIndex + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

function isActiveReservationStatus(status: string) {
  return status === 'PENDING' || status === 'CONFIRMED';
}

/** 選択した日付（生徒のカレンダー上の日付文字列 "YYYY-MM-DD"）に対して、先生の提供枠（7:00〜14:00）を生成し、生徒のTZでの時間枠リストを返す */
function generateAvailableSlots(selectedDateStr: string, studentTz: string, teacherTz = 'Asia/Tokyo') {
  // カレンダーで選んだ日付（生徒TZ）の「正午」をUTCで求める
  const noonUTC = fromZonedTime(`${selectedDateStr}T12:00:00`, studentTz);

  // その正午が、先生のTZでは「何日」にあたるかを計算
  const teacherDateStr = formatInTimeZone(noonUTC, teacherTz, 'yyyy-MM-dd');
  
  const selectedDayStart = fromZonedTime(`${selectedDateStr}T00:00:00`, studentTz).getTime();
  const selectedDayEnd = fromZonedTime(`${selectedDateStr}T23:59:59.999`, studentTz).getTime();
  const slots: AvailableSlot[] = [];

  // タイムゾーンによっては先生側の前日/翌日の枠が、生徒の選んだ日に見える。
  for (const candidateTeacherDateStr of [-1, 0, 1].map(offset => shiftDateStr(teacherDateStr, offset))) {
    for (let h = 7; h <= 14; h++) {
      for (let m = 0; m < 60; m += SLOT_INTERVAL) {
        if (h === 14 && m > 0) break;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const slotUTC = fromZonedTime(`${candidateTeacherDateStr}T${timeStr}:00`, teacherTz);
        const slotTime = slotUTC.getTime();
        if (slotTime < selectedDayStart || slotTime > selectedDayEnd) continue;

        slots.push({
          startTimeUTC: slotUTC,
          displayTime: formatInTimeZone(slotUTC, studentTz, 'HH:mm'),
          timeKey: slotUTC.toISOString(),
        });
      }
    }
  }

  return Array.from(new Map(slots.map(slot => [slot.timeKey, slot])).values())
    .sort((a, b) => a.startTimeUTC.getTime() - b.startTimeUTC.getTime());
}

// ===== メインコンポーネント =====
export default function BookingView({ userRole, roomId, language = 'ja', timezone = 'Asia/Tokyo' }: BookingViewProps) {
  // 表示ステップ: 'calendar' | 'time' | 'confirm' | 'list'
  const tz = timezone || 'Asia/Tokyo';
  const [currentTimeMs, setCurrentTimeMs] = useState(() => new Date().getTime());
  const nowZoned = toZonedTime(currentTimeMs, tz);
  const [step, setStep] = useState<'calendar' | 'time' | 'confirm' | 'list'>('calendar');
  const [calYear, setCalYear] = useState(nowZoned.getFullYear());
  const [calMonth, setCalMonth] = useState(nowZoned.getMonth());
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null);
  const [selectedTimeKey, setSelectedTimeKey] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  // レッスンメニュー
  const [menus, setMenus] = useState<LessonMenu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);

  const selectedMenu = menus.find(m => m.id === selectedMenuId);
  const lessonDuration = selectedMenu ? selectedMenu.duration : DEFAULT_LESSON_DURATION;
  const isFreeStudentBooking = userRole === 'STUDENT' && selectedMenu !== undefined && selectedMenu.price <= 0;

  // 選択日のスロットを生成
  const dailySlots = React.useMemo(() => {
    if (!selectedDateStr) return [];
    return generateAvailableSlots(selectedDateStr, tz, TEACHER_TZ);
  }, [selectedDateStr, tz]);

  // データ
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [busySlots, setBusySlots] = useState<BusySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [paymentNotice, setPaymentNotice] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(new Date().getTime());
    }, 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const payment = params.get('payment');
      if (!payment) return;

      if (payment === 'success') {
        setPaymentNotice({
          type: 'success',
          message: language === 'en'
            ? 'Payment was received. Your reservation may take a moment to change from payment pending to confirmed.'
            : '決済を受け付けました。予約一覧で「支払い待ち」から「確定」に変わるまで少し時間がかかることがあります。',
        });
        setStep('list');
      } else if (payment === 'cancelled') {
        setPaymentNotice({
          type: 'info',
          message: language === 'en'
            ? 'Payment was cancelled. The time slot has been released, so you can book again.'
            : '決済をキャンセルしました。予約枠は戻っているので、もう一度予約できます。',
        });
        setStep('calendar');
      } else if (payment === 'error') {
        setPaymentNotice({
          type: 'error',
          message: language === 'en'
            ? 'Could not confirm the payment status. Please refresh the reservation list or contact the teacher.'
            : '決済状況を確認できませんでした。予約一覧を更新するか、先生へ連絡してください。',
        });
        setStep('list');
      }

      params.delete('payment');
      params.delete('reservationId');
      const nextSearch = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [language]);



  // 予約とブロック時間帯、メニューを取得
  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const months = getAdjacentMonthStrings(calYear, calMonth);
      const menusParams = new URLSearchParams();
      if (roomId) menusParams.set('roomId', roomId);

      const reservationRequests = months.map(monthStr => {
        const params = new URLSearchParams({ month: monthStr });
        if (roomId) params.set('roomId', roomId);
        return fetch(`/api/reservations?${params}`);
      });
      const blockedRequests = months.map(monthStr => fetch(`/api/blocked-slots?month=${monthStr}`));

      const [reservationResponses, blockedResponses, menusRes] = await Promise.all([
        Promise.all(reservationRequests),
        Promise.all(blockedRequests),
        fetch(`/api/menus?${menusParams}`),
      ]);

      if (!menusRes.ok || reservationResponses.some(res => !res.ok) || blockedResponses.some(res => !res.ok)) {
        throw new Error('FETCH_FAILED');
      }

      const reservationPayloads = await Promise.all(reservationResponses.map(res => res.json()));
      const blockedPayloads = await Promise.all(blockedResponses.map(res => res.json()));
      const menusData = await menusRes.json();

      const nextReservations = reservationPayloads.flatMap(data => data.reservations || []);
      const nextBlockedSlots = blockedPayloads.flatMap(data => data.blockedSlots || []);
      const nextBusySlots = reservationPayloads.flatMap(data => data.busySlots || []);
      setReservations(Array.from(new Map(nextReservations.map((r: Reservation) => [r.id, r])).values()));
      setBlockedSlots(Array.from(new Map(nextBlockedSlots.map((b: BlockedSlot) => [b.id, b])).values()));
      setBusySlots(Array.from(new Map(nextBusySlots.map((slot: BusySlot) => [`${slot.startTime}-${slot.endTime}`, slot])).values()));
      if (menusData.menus) {
        setMenus(menusData.menus);
        if (menusData.menus.length > 0 && (!selectedMenuId || !menusData.menus.some((m: LessonMenu) => m.id === selectedMenuId))) {
          setSelectedMenuId(menusData.menus[0].id);
        } else if (menusData.menus.length === 0) {
          setSelectedMenuId(null);
        }
      }
    } catch {
      console.error('データ取得エラー');
      setLoadError(language === 'en' ? 'Could not load reservation data. Please try again.' : '予約情報を読み込めませんでした。時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  }, [calYear, calMonth, roomId, selectedMenuId, language]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const socket = getSocket();
    const handleScheduleUpdated = (data: ScheduleUpdatedPayload) => {
      if (data.type === 'blocked-slot' || data.type === 'reservation-availability' || !roomId || data.roomId === roomId) {
        void fetchData();
      }
    };

    socket.on('schedule_updated', handleScheduleUpdated);
    return () => {
      socket.off('schedule_updated', handleScheduleUpdated);
    };
  }, [fetchData, roomId]);

  // ===== カレンダー描画データ =====
  const year = calYear;
  const month = calMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const getReservationsForDate = (dateStr: string): Reservation[] => {
    return reservations.filter((r) => {
      return toDateStrTZ(r.startTime, tz) === dateStr && isActiveReservationStatus(r.status);
    });
  };

  // ===== 月の切り替え =====
  const isCurrentMonth = year === nowZoned.getFullYear() && month === nowZoned.getMonth();

  const prevMonth = () => {
    if (isCurrentMonth) return;
    if (month === 0) {
      setCalYear(year - 1);
      setCalMonth(11);
    } else {
      setCalMonth(month - 1);
    }
    setSelectedDateStr(null);
    setSelectedTimeKey(null);
  };
  const nextMonth = () => {
    if (month === 11) {
      setCalYear(year + 1);
      setCalMonth(0);
    } else {
      setCalMonth(month + 1);
    }
    setSelectedDateStr(null);
    setSelectedTimeKey(null);
  };

  // ===== 時間帯スロットの空き状況を計算 =====
  const unavailableSlotKeys = (() => {
    const unavailable = new Set<string>();
    if (!selectedDateStr) return unavailable;

    const nowUTC = new Date();
    const cutoffUTC = addMinutes(nowUTC, 120);

    dailySlots.forEach(slot => {
      const slotStart = slot.startTimeUTC;
      const slotEnd = addMinutes(slotStart, lessonDuration);
      const checkStart = addMinutes(slotStart, -BUFFER_MINUTES);
      const checkEnd = addMinutes(slotEnd, BUFFER_MINUTES);

      // 予約との重複チェック
      const isReserved = reservations.some(r => {
        if (!isActiveReservationStatus(r.status)) return false;
        const rStart = new Date(r.startTime);
        const rEnd = new Date(r.endTime);
        return rStart < checkEnd && rEnd > checkStart;
      });

      // 他の生徒の予約を含む、先生全体の埋まり時間との重複チェック
      const isBusy = busySlots.some(b => {
        const bStart = new Date(b.startTime);
        const bEnd = new Date(b.endTime);
        return bStart < checkEnd && bEnd > checkStart;
      });

      // ブロック時間帯との重複チェック
      const isBlocked = blockedSlots.some(b => {
        const bStart = new Date(b.startTime);
        const bEnd = new Date(b.endTime);
        return bStart < checkEnd && bEnd > checkStart;
      });

      // 当日の2時間前制限
      const isTooClose = slotStart < cutoffUTC;

      if (isReserved || isBusy || isBlocked || isTooClose) {
        unavailable.add(slot.timeKey);
      }
    });
    return unavailable;
  })();

  // ===== 予約送信 =====
  const handleSubmit = async () => {
    if (!selectedDateStr || !selectedTimeKey) return;
    if (!selectedMenu) {
      setError(language === 'en' ? 'Please select a lesson menu.' : 'レッスンメニューを選択してください。');
      return;
    }
    setSubmitLoading(true);
    setError('');

    const startTime = new Date(selectedTimeKey);

    try {
      // ルームIDからstudentIdを割り出す必要がある場合は先生側
      const body: Record<string, unknown> = {
        startTime: startTime.toISOString(),
        notes: notes || undefined,
        roomId: roomId || undefined,
        lessonMenuId: selectedMenuId || undefined,
      };

      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(getReservationErrorMessage(data.errorCode, language, 'RESERVATION_CREATE_FAILED', data.error));
        setSubmitLoading(false);
        return;
      }

      const data = await res.json();
      if (typeof data.checkoutUrl === 'string' && data.checkoutUrl.length > 0) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      // 成功→データ再取得してカレンダーに戻る
      await fetchData();
      setSelectedDateStr(null);
      setSelectedTimeKey(null);
      setNotes('');
      setStep('calendar');
    } catch {
      setError(language === 'en' ? 'Network error while creating the reservation.' : '予約作成中に通信エラーが発生しました。');
    } finally {
      setSubmitLoading(false);
    }
  };

  // ===== 予約キャンセル =====
  const handleCancel = async (reservationId: string) => {
    if (!confirm(language === 'en' ? 'Cancel this reservation?' : 'この予約をキャンセルしますか？')) return;
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.status === 'REFUNDED') {
          setPaymentNotice({
            type: 'success',
            message: language === 'en'
              ? 'The reservation was cancelled and the refund has been started.'
              : '予約をキャンセルし、返金処理を開始しました。',
          });
        } else {
          setPaymentNotice({
            type: 'info',
            message: language === 'en'
              ? 'The reservation was cancelled.'
              : '予約をキャンセルしました。',
          });
        }
        await fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        setPaymentNotice({
          type: 'error',
          message: getReservationErrorMessage(data.errorCode, language, 'RESERVATION_CANCEL_FAILED', data.error),
        });
      }
    } catch {
      setPaymentNotice({
        type: 'error',
        message: language === 'en' ? 'Network error while cancelling the reservation.' : '予約キャンセル中に通信エラーが発生しました。',
      });
    }
  };



  // ===== 今後の予約一覧 =====
  const upcomingReservations = reservations
    .filter(r => new Date(r.startTime).getTime() >= currentTimeMs && isActiveReservationStatus(r.status))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const canStartBooking = menus.length > 0 && !loadError;
  const canCancelReservation = (reservation: Reservation) => (
    userRole === 'TEACHER' ||
    reservation.status === 'PENDING' ||
    new Date(reservation.startTime).getTime() - currentTimeMs >= 24 * 60 * 60 * 1000
  );

  const getReservationStatusLabel = (status: string) => {
    if (status === 'CONFIRMED') return language === 'en' ? '✓ Confirmed' : '✓ 確定';
    if (status === 'COMPLETED') return language === 'en' ? '✓ Completed' : '✓ 完了';
    if (status === 'PENDING') return language === 'en' ? 'Payment pending' : '支払い待ち';
    if (status === 'REFUNDED') return language === 'en' ? 'Refunded' : '返金済み';
    return status;
  };



  return (
    <div className="booking-view">
      {/* ===== ヘッダー: タブ切り替え ===== */}
      <div className="booking-tabs">
        <button
          className={`booking-tab ${step === 'calendar' || step === 'time' || step === 'confirm' ? 'active' : ''}`}
          onClick={() => { setStep('calendar'); setSelectedDateStr(null); setSelectedTimeKey(null); }}
        >
          {language === 'en' ? 'Book a Lesson' : '予約する'}
        </button>
        <button
          className={`booking-tab ${step === 'list' ? 'active' : ''}`}
          onClick={() => setStep('list')}
        >
          {language === 'en' ? 'Reservations' : '予約一覧'} {upcomingReservations.length > 0 && (
            <span className="booking-tab__badge">{upcomingReservations.length}</span>
          )}
        </button>
      </div>

      {paymentNotice && (
        <div
          className={paymentNotice.type === 'error' ? 'booking-confirm__error' : 'booking-confirm__info'}
          style={{
            width: 'calc(100% - 48px)',
            maxWidth: 952,
            margin: '16px 24px 0',
            background: paymentNotice.type === 'success' ? 'var(--green-bg)' : undefined,
            color: paymentNotice.type === 'success' ? 'var(--green)' : undefined,
          }}
        >
          {paymentNotice.message}
        </div>
      )}

      {/* ===== ステップ1: カレンダー ===== */}
      {step === 'calendar' && (
        <div className="booking-container">
          {loadError && <div className="booking-confirm__error" style={{ margin: '0 24px 16px' }}>{loadError}</div>}
          {!loading && !loadError && menus.length === 0 && (
            <div className="booking-confirm__error" style={{ margin: '0 24px 16px' }}>
              {language === 'en' ? 'No lesson menus are available yet.' : '予約できるレッスンメニューがまだありません。'}
            </div>
          )}
          {menus.length > 0 && (
            <div style={{ marginBottom: '1rem', padding: '1rem', background: '#27272a', borderRadius: '8px' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: '#a1a1aa' }}>
                {language === 'en' ? 'Select Lesson Menu' : 'レッスンメニューを選択'}
              </label>
              <select
                value={selectedMenuId || ''}
                onChange={e => setSelectedMenuId(e.target.value)}
                style={{ width: '100%', padding: '0.75rem', background: '#18181b', border: '1px solid #3f3f46', borderRadius: '8px', color: '#fff', fontSize: '1rem' }}
              >
                {menus.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.specialPriceApplied ? (language === 'en' ? '[Special] ' : '【特価】') : ''}{m.name} ({m.duration}{language === 'en' ? ' min' : '分'} / ${m.price.toLocaleString()})
                  </option>
                ))}
              </select>
              {selectedMenu?.specialPriceApplied && (
                <div style={{ display: 'inline-flex', marginTop: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '999px', background: 'rgba(52, 211, 153, 0.16)', color: '#6ee7b7', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  {language === 'en' ? 'Special price' : '特価対象メニュー'}
                </div>
              )}
              {selectedMenu?.description && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#a1a1aa' }}>{selectedMenu.description}</p>
              )}
            </div>
          )}

          <div className="booking-calendar">
            <div className="booking-calendar__nav">
              <button className="booking-calendar__nav-btn" onClick={prevMonth} disabled={isCurrentMonth}>‹</button>
              <span className="booking-calendar__month">{language === 'en' ? `${year}-${String(month + 1).padStart(2, '0')}` : `${year}年${month + 1}月`}</span>
              <button className="booking-calendar__nav-btn" onClick={nextMonth}>›</button>
            </div>

            {/* 曜日ヘッダー */}
            <div className="booking-calendar__weekdays">
              {(language === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : WEEKDAYS).map(w => (
                <div key={w} className="booking-calendar__weekday">{w}</div>
              ))}
            </div>

            {/* 日付グリッド */}
            <div className="booking-calendar__grid">
              {/* 月初の空セル */}
              {Array.from({ length: firstDay }).map((_, i) => (
                <div key={`empty-${i}`} className="booking-calendar__day booking-calendar__day--empty" />
              ))}

              {/* 日付セル */}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                const cellDateNum = year * 10000 + month * 100 + day;
                const todayNum = nowZoned.getFullYear() * 10000 + nowZoned.getMonth() * 100 + nowZoned.getDate();
                
                const isPast = cellDateNum < todayNum;
                const isSelected = selectedDateStr === dateStr;
                const isToday = cellDateNum === todayNum;
                
                const dayReservations = getReservationsForDate(dateStr);
                const hasReservation = dayReservations.length > 0;

                return (
                  <div
                    key={day}
                    className={[
                      'booking-calendar__day',
                      isPast ? 'booking-calendar__day--past' : '',
                      isSelected ? 'booking-calendar__day--selected' : '',
                      isToday ? 'booking-calendar__day--today' : '',
                      hasReservation ? 'booking-calendar__day--has-event' : '',
                    ].join(' ')}
                    onClick={() => {
                      if (!isPast && canStartBooking) {
                        setSelectedDateStr(dateStr);
                        setSelectedTimeKey(null);
                        setStep('time');
                      }
                    }}
                  >
                    <span className="booking-calendar__day-number">{day}</span>
                    {hasReservation && (
                      <div className="booking-calendar__day-dots">
                        {dayReservations.slice(0, 3).map((_, di) => (
                          <span key={di} className="booking-calendar__day-dot" />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ローディング表示 */}
            {loading && (
              <div className="booking-loading">
                <div className="login-form__spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
              </div>
            )}


          </div>
        </div>
      )}

      {/* ===== ステップ2: 時間帯選択 ===== */}
      {step === 'time' && selectedDateStr && (
        <div className="booking-container">
          <div className="booking-time">
            <button className="booking-back-btn" onClick={() => { setStep('calendar'); setSelectedTimeKey(null); }}>
              ‹ {language === 'en' ? 'Back to Calendar' : 'カレンダーに戻る'}
            </button>

            <div className="booking-time__header">
              <span className="booking-time__date">{formatDateJPTZ(fromZonedTime(`${selectedDateStr}T00:00:00`, tz), tz, language)}</span>
              <span className="booking-time__sub">{language === 'en' ? 'Lesson Duration: ' : 'レッスン時間: '}{lessonDuration}{language === 'en' ? ' min' : '分'}</span>
              {selectedMenu && (
                <span className="booking-time__sub">
                  {selectedMenu.specialPriceApplied ? (language === 'en' ? '[Special] ' : '【特価】') : ''}
                  {selectedMenu.name} / ${selectedMenu.price.toLocaleString()}
                </span>
              )}
            </div>

            {/* 前半 / 後半 の2カラムで表示 */}
            {(() => {
              // 時間ごとにスロットをグループ化
              const hourGroups = new Map<number, typeof dailySlots>();
              dailySlots.forEach(slot => {
                const hour = parseInt(slot.displayTime.split(':')[0], 10);
                if (!hourGroups.has(hour)) hourGroups.set(hour, []);
                hourGroups.get(hour)!.push(slot);
              });

              // 前半と後半に分割（時系列順に並んでいるので、そのまま半分に割るのが一番自然）
              const allHours = Array.from(hourGroups.entries());
              const middleIndex = Math.ceil(allHours.length / 2);
              const firstHalf = allHours.slice(0, middleIndex);
              const secondHalf = allHours.slice(middleIndex);

              const renderColumn = (hours: [number, typeof dailySlots][]) =>
                hours.map(([hour, slots]) => (
                  <div key={hour} className="booking-time__hour-row">
                    <div className="booking-time__hour-label">{hour}:00</div>
                    <div className="booking-time__hour-slots">
                      {slots.map(slot => {
                        const isUnavailable = unavailableSlotKeys.has(slot.timeKey);
                        const isSelected = selectedTimeKey === slot.timeKey;
                        const slotEndTime = formatInTimeZone(addMinutes(slot.startTimeUTC, lessonDuration), tz, 'HH:mm');

                        return (
                          <button
                            key={slot.timeKey}
                            className={[
                              'booking-time__slot',
                              isUnavailable ? 'booking-time__slot--disabled' : '',
                              isSelected ? 'booking-time__slot--selected' : '',
                            ].join(' ')}
                            disabled={isUnavailable}
                            onClick={() => setSelectedTimeKey(slot.timeKey)}
                          >
                            <span className="booking-time__slot-start">{slot.displayTime}</span>
                            <span className="booking-time__slot-end">
                              {isUnavailable ? '✕' : `〜${slotEndTime}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ));

              if (dailySlots.length === 0) {
                return (
                  <div className="booking-time__empty">
                    {language === 'en' ? 'No available slots for this date.' : 'この日に選べる時間帯はありません。'}
                  </div>
                );
              }

              return (
                <div className="booking-time__columns">
                  <div className="booking-time__column">
                    {renderColumn(firstHalf)}
                  </div>
                  <div className="booking-time__column">
                    {renderColumn(secondHalf)}
                  </div>
                </div>
              );
            })()}

            {selectedTimeKey && (
              <div className="booking-time__confirm-bar">
                <div className="booking-time__confirm-info">
                  <span>{formatDateJPTZ(new Date(selectedTimeKey), tz, language)}</span>
                  <span className="booking-time__confirm-time">
                    {formatInTimeZone(new Date(selectedTimeKey), tz, 'HH:mm')}〜
                    {formatInTimeZone(addMinutes(new Date(selectedTimeKey), lessonDuration), tz, 'HH:mm')}
                  </span>
                </div>
                <button className="booking-time__confirm-btn" onClick={() => setStep('confirm')}>
                  {language === 'en' ? 'Next' : '確認へ'} <IconChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== ステップ3: 確認画面 ===== */}
      {step === 'confirm' && selectedDateStr && selectedTimeKey && (
        <div className="booking-container">
          <div className="booking-confirm">
            <button className="booking-back-btn" onClick={() => setStep('time')}>
              ‹ {language === 'en' ? 'Back to Time Selection' : '時間選択に戻る'}
            </button>

            <div className="booking-confirm__card">
              <div className="booking-confirm__title">{language === 'en' ? 'Confirm Reservation' : 'レッスン予約の確認'}</div>

              <div className="booking-confirm__row">
                <span className="booking-confirm__label">{language === 'en' ? 'Date' : '日付'}</span>
                <span className="booking-confirm__value">{formatDateJPTZ(new Date(selectedTimeKey), tz, language)}</span>
              </div>
              <div className="booking-confirm__row">
                <span className="booking-confirm__label">{language === 'en' ? 'Time' : '時間'}</span>
                <span className="booking-confirm__value">
                  {formatInTimeZone(new Date(selectedTimeKey), tz, 'HH:mm')}〜
                  {formatInTimeZone(addMinutes(new Date(selectedTimeKey), lessonDuration), tz, 'HH:mm')}
                </span>
              </div>
              <div className="booking-confirm__row">
                <span className="booking-confirm__label">{language === 'en' ? 'Duration' : 'レッスン時間'}</span>
                <span className="booking-confirm__value">{lessonDuration}{language === 'en' ? ' min' : '分'}</span>
              </div>
              {selectedMenu && (
                <div className="booking-confirm__row">
                  <span className="booking-confirm__label">{language === 'en' ? 'Menu' : 'メニュー'}</span>
                  <span className="booking-confirm__value">{selectedMenu.specialPriceApplied ? (language === 'en' ? '[Special] ' : '【特価】') : ''}{selectedMenu.name} (${selectedMenu.price.toLocaleString()})</span>
                </div>
              )}

              <div className="booking-confirm__notes">
                <label className="booking-confirm__notes-label">{language === 'en' ? 'Notes (Optional)' : 'メモ（任意）'}</label>
                <textarea
                  className="booking-confirm__notes-input"
                  placeholder={language === 'en' ? 'Enter any requests or notes for the teacher' : '先生へのリクエストやメモがあれば入力してください'}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              {error && <div className="booking-confirm__error">{error}</div>}

              <div className="booking-confirm__info">
                💡 {userRole === 'STUDENT'
                  ? (isFreeStudentBooking
                    ? (language === 'en' ? 'This free reservation will be confirmed without Stripe Checkout.' : '無料メニューのため、Stripe決済なしで予約を確定します')
                    : (language === 'en' ? 'After confirming, you will continue to Stripe Checkout.' : '予約内容を確認したあと、Stripeの決済画面へ進みます'))
                  : (language === 'en' ? 'Teacher-created reservations are confirmed without payment.' : '先生が追加する予約は決済なしで確定します')}
              </div>

              <button
                className="booking-confirm__submit"
                onClick={handleSubmit}
                disabled={submitLoading || !selectedMenu}
              >
                {submitLoading
                  ? (userRole === 'STUDENT'
                    ? (isFreeStudentBooking
                      ? (language === 'en' ? 'Booking...' : '予約中...')
                      : (language === 'en' ? 'Preparing payment...' : '決済画面を準備中...'))
                    : (language === 'en' ? 'Booking...' : '予約中...'))
                  : (userRole === 'STUDENT'
                    ? (isFreeStudentBooking
                      ? (language === 'en' ? 'Confirm Free Reservation' : '無料予約を確定')
                      : (language === 'en' ? 'Continue to Payment' : '決済へ進む'))
                    : (language === 'en' ? 'Confirm Reservation' : '予約を確定する'))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 予約一覧 ===== */}
      {step === 'list' && (
        <div className="booking-container">
          <div className="booking-list">
            {upcomingReservations.length === 0 ? (
              <div className="booking-list__empty">
                <div className="booking-list__empty-icon">📅</div>
                <div className="booking-list__empty-title">{language === 'en' ? 'No Reservations' : '予約はありません'}</div>
                <div className="booking-list__empty-desc">
                  {language === 'en' ? 'Select a date and time from the calendar to book a lesson.' : 'カレンダーから日時を選んで予約しましょう'}
                </div>
              </div>
            ) : (
              upcomingReservations.map(r => {
                const startZoned = toZonedTime(r.startTime, tz);
                return (
                  <div key={r.id} className="booking-list__item">
                    <div className="booking-list__item-date">
                      <span className="booking-list__item-month">{language === 'en' ? `${startZoned.getMonth() + 1}/` : `${startZoned.getMonth() + 1}月`}</span>
                      <span className="booking-list__item-day">{startZoned.getDate()}</span>
                      <span className="booking-list__item-weekday">{(language === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : WEEKDAYS)[startZoned.getDay()]}</span>
                    </div>
                    <div className="booking-list__item-info">
                      <div className="booking-list__item-time">
                        {formatTimeTZ(r.startTime, tz)}
                        〜
                        {formatTimeTZ(r.endTime, tz)}
                      </div>
                      {userRole === 'TEACHER' && r.student && (
                        <div className="booking-list__item-student">{r.student.name}</div>
                      )}
                      {r.notes && (
                        <div className="booking-list__item-notes">{r.notes}</div>
                      )}
                      <div className={`booking-list__item-status booking-list__item-status--${r.status.toLowerCase()}`}>
                        {getReservationStatusLabel(r.status)}
                      </div>
                    </div>
                    {canCancelReservation(r) ? (
                      <button
                        className="booking-list__item-cancel"
                        onClick={() => handleCancel(r.id)}
                        title={language === 'en' ? 'Cancel' : 'キャンセル'}
                      >
                        <IconX size={14} />
                      </button>
                    ) : (
                      <button
                        className="booking-list__item-cancel"
                        disabled
                        title={language === 'en' ? 'Less than 24 hours before start' : '開始24時間以内は先生に連絡してください'}
                      >
                        <IconX size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}


    </div>
  );
}
