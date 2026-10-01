const TEACHER_TIMEZONE = "Asia/Tokyo";

export type ReservationMessageLanguage = "en" | "ja";

export type ReservationErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "FORBIDDEN"
  | "MENUS_FETCH_FAILED"
  | "RESERVATIONS_FETCH_FAILED"
  | "START_TIME_REQUIRED"
  | "LESSON_MENU_REQUIRED"
  | "START_TIME_INVALID"
  | "PAST_TIME"
  | "MIN_ADVANCE_REQUIRED"
  | "UNBOOKABLE_TIME"
  | "STUDENT_ROOM_NOT_FOUND"
  | "LESSON_MENU_UNAVAILABLE"
  | "STUDENT_NOT_FOUND"
  | "INVALID_MENU_PRICE"
  | "STRIPE_NOT_CONNECTED"
  | "STRIPE_CHECKOUT_CREATE_FAILED"
  | "OVERLAPPING_RESERVATION"
  | "BLOCKED_SLOT"
  | "FREE_TRIAL_ALREADY_USED"
  | "CONCURRENT_RESERVATION"
  | "RESERVATION_CREATE_FAILED"
  | "RESERVATION_NOT_FOUND"
  | "ROOM_NOT_FOUND"
  | "CANCEL_FORBIDDEN"
  | "CANCEL_TOO_LATE"
  | "CANCEL_COMPLETED"
  | "CHECKOUT_ALREADY_PAID"
  | "STRIPE_ACCOUNT_NOT_FOUND"
  | "STRIPE_CANCEL_OR_REFUND_FAILED"
  | "RESERVATION_CANCEL_FAILED"
  | "BLOCKED_SLOTS_FETCH_FAILED"
  | "BLOCK_TEACHER_ONLY"
  | "BLOCK_TIME_REQUIRED"
  | "BLOCK_TIME_INVALID"
  | "BLOCK_INTERVAL_INVALID"
  | "BLOCK_OVERLAPPING_RESERVATION"
  | "BLOCK_OVERLAPPING_BLOCKED_SLOT"
  | "BLOCK_CREATE_FAILED"
  | "BLOCK_DELETE_TEACHER_ONLY"
  | "BLOCK_ID_REQUIRED"
  | "BLOCK_NOT_FOUND"
  | "BLOCK_DELETE_FAILED"
  | "UNKNOWN_ERROR";

const ERROR_MESSAGES: Record<ReservationErrorCode, Record<ReservationMessageLanguage, string>> = {
  AUTH_REQUIRED: {
    en: "Please sign in again.",
    ja: "もう一度ログインしてください。",
  },
  AUTH_INVALID: {
    en: "Your session is no longer valid. Please sign in again.",
    ja: "ログイン状態が無効です。もう一度ログインしてください。",
  },
  FORBIDDEN: {
    en: "You do not have permission to do this.",
    ja: "この操作を行う権限がありません。",
  },
  MENUS_FETCH_FAILED: {
    en: "Could not load lesson menus. Please try again.",
    ja: "レッスンメニューを読み込めませんでした。もう一度お試しください。",
  },
  RESERVATIONS_FETCH_FAILED: {
    en: "Could not load reservation data. Please try again.",
    ja: "予約情報を読み込めませんでした。もう一度お試しください。",
  },
  START_TIME_REQUIRED: {
    en: "Please choose a start time.",
    ja: "開始時刻を指定してください。",
  },
  LESSON_MENU_REQUIRED: {
    en: "Please select a lesson menu.",
    ja: "レッスンメニューを選択してください。",
  },
  START_TIME_INVALID: {
    en: "The selected start time is invalid. Please choose another time.",
    ja: "開始時刻の形式が正しくありません。別の時間を選んでください。",
  },
  PAST_TIME: {
    en: "You cannot book a time in the past.",
    ja: "過去の日時には予約できません。",
  },
  MIN_ADVANCE_REQUIRED: {
    en: "Reservations must be made at least 2 hours before the lesson starts.",
    ja: "予約はレッスン開始2時間前までに行ってください。",
  },
  UNBOOKABLE_TIME: {
    en: "This time slot is not available.",
    ja: "選択できる時間帯ではありません。",
  },
  STUDENT_ROOM_NOT_FOUND: {
    en: "Could not find the student's room.",
    ja: "生徒のルームが見つかりません。",
  },
  LESSON_MENU_UNAVAILABLE: {
    en: "The selected lesson menu is not available.",
    ja: "選択されたメニューは利用できません。",
  },
  STUDENT_NOT_FOUND: {
    en: "Could not find the student.",
    ja: "生徒が見つかりません。",
  },
  INVALID_MENU_PRICE: {
    en: "The lesson menu price is invalid.",
    ja: "メニュー料金が不正です。",
  },
  STRIPE_NOT_CONNECTED: {
    en: "The teacher has not finished connecting Stripe yet, so this lesson cannot be booked.",
    ja: "先生のStripe連携が完了していないため、まだ予約できません。",
  },
  STRIPE_CHECKOUT_CREATE_FAILED: {
    en: "Could not open the payment page. Please wait a moment and try again.",
    ja: "決済画面の作成に失敗しました。時間をおいて再度お試しください。",
  },
  OVERLAPPING_RESERVATION: {
    en: "There is already a reservation during this time slot.",
    ja: "この時間帯にはすでに予約が入っています。",
  },
  BLOCKED_SLOT: {
    en: "This time slot is blocked and cannot be booked.",
    ja: "この時間帯は予約不可に設定されています。",
  },
  FREE_TRIAL_ALREADY_USED: {
    en: "A free trial can only be booked once per account.",
    ja: "無料体験は1つのアカウントにつき1回まで予約できます。",
  },
  CONCURRENT_RESERVATION: {
    en: "Another reservation was made at the same time. Please refresh the availability and try again.",
    ja: "同時に予約が入りました。最新の空き状況を確認してください。",
  },
  RESERVATION_CREATE_FAILED: {
    en: "Could not create the reservation. Please try again.",
    ja: "予約の作成に失敗しました。もう一度お試しください。",
  },
  RESERVATION_NOT_FOUND: {
    en: "Could not find this reservation.",
    ja: "予約が見つかりません。",
  },
  ROOM_NOT_FOUND: {
    en: "Could not find the room for this reservation.",
    ja: "予約に紐づくルームが見つかりません。",
  },
  CANCEL_FORBIDDEN: {
    en: "You do not have permission to cancel this reservation.",
    ja: "この予約をキャンセルする権限がありません。",
  },
  CANCEL_TOO_LATE: {
    en: "Reservations within 24 hours of the lesson start cannot be cancelled here. Please contact the teacher.",
    ja: "レッスン開始24時間以内のキャンセルは先生に連絡してください。",
  },
  CANCEL_COMPLETED: {
    en: "Completed lessons cannot be cancelled from this screen.",
    ja: "完了済みのレッスンはこの画面からキャンセルできません。",
  },
  CHECKOUT_ALREADY_PAID: {
    en: "The payment may have already completed. Please wait a moment and refresh the reservation list.",
    ja: "決済が完了している可能性があります。少し待ってから予約一覧を更新してください。",
  },
  STRIPE_ACCOUNT_NOT_FOUND: {
    en: "Could not confirm the Stripe account used for this payment, so it cannot be cancelled automatically. Please contact support.",
    ja: "決済に使ったStripeアカウントを確認できないため、自動キャンセルできません。管理者に連絡してください。",
  },
  STRIPE_CANCEL_OR_REFUND_FAILED: {
    en: "Stripe could not cancel or refund the payment. The reservation was not changed.",
    ja: "Stripeでの返金または決済キャンセルに失敗しました。予約は変更していません。",
  },
  RESERVATION_CANCEL_FAILED: {
    en: "Could not cancel the reservation. Please try again.",
    ja: "予約のキャンセルに失敗しました。もう一度お試しください。",
  },
  BLOCKED_SLOTS_FETCH_FAILED: {
    en: "Could not load blocked time slots. Please try again.",
    ja: "ブロック時間帯を読み込めませんでした。もう一度お試しください。",
  },
  BLOCK_TEACHER_ONLY: {
    en: "Only teachers can block time slots.",
    ja: "先生のみがブロック時間帯を設定できます。",
  },
  BLOCK_TIME_REQUIRED: {
    en: "Please choose the start and end time.",
    ja: "開始時刻と終了時刻を指定してください。",
  },
  BLOCK_TIME_INVALID: {
    en: "The start or end time is invalid.",
    ja: "開始時刻と終了時刻の形式が正しくありません。",
  },
  BLOCK_INTERVAL_INVALID: {
    en: "Blocked time slots must be set in 15-minute units.",
    ja: "ブロック時間帯は15分単位で指定してください。",
  },
  BLOCK_OVERLAPPING_RESERVATION: {
    en: "There is already a reservation during this time slot.",
    ja: "この時間帯にはすでに予約が入っています。",
  },
  BLOCK_OVERLAPPING_BLOCKED_SLOT: {
    en: "This time slot is already blocked.",
    ja: "この時間帯はすでにブロックされています。",
  },
  BLOCK_CREATE_FAILED: {
    en: "Could not save the blocked time slot.",
    ja: "ブロック時間帯を保存できませんでした。",
  },
  BLOCK_DELETE_TEACHER_ONLY: {
    en: "Only teachers can remove blocked time slots.",
    ja: "先生のみがブロック時間帯を削除できます。",
  },
  BLOCK_ID_REQUIRED: {
    en: "Could not identify the blocked time slot.",
    ja: "ブロック時間帯を特定できませんでした。",
  },
  BLOCK_NOT_FOUND: {
    en: "Could not find the blocked time slot.",
    ja: "ブロック時間帯が見つかりません。",
  },
  BLOCK_DELETE_FAILED: {
    en: "Could not remove the blocked time slot.",
    ja: "ブロック時間帯の削除に失敗しました。",
  },
  UNKNOWN_ERROR: {
    en: "Something went wrong. Please try again.",
    ja: "問題が発生しました。もう一度お試しください。",
  },
};

export function normalizeReservationLanguage(language?: string): ReservationMessageLanguage {
  return language === "en" ? "en" : "ja";
}

export function getReservationErrorMessage(
  code: unknown,
  language: string = "ja",
  fallbackCode: ReservationErrorCode = "UNKNOWN_ERROR",
  fallbackText?: unknown
) {
  const normalizedLanguage = normalizeReservationLanguage(language);
  const normalizedCode =
    typeof code === "string" && code in ERROR_MESSAGES
      ? (code as ReservationErrorCode)
      : fallbackCode;
  const message = ERROR_MESSAGES[normalizedCode]?.[normalizedLanguage];
  if (message) return message;

  if (normalizedLanguage === "ja" && typeof fallbackText === "string" && fallbackText.trim()) {
    return fallbackText;
  }
  return ERROR_MESSAGES[fallbackCode][normalizedLanguage];
}

export type ReservationSystemMessageType =
  | "reservation_confirmed"
  | "reservation_added_by_teacher"
  | "reservation_cancelled"
  | "reservation_refund_started";

type ReservationSystemMessagePayload = {
  type: ReservationSystemMessageType;
  startTime: string;
  endTime?: string;
  notes?: string | null;
};

const SYSTEM_MESSAGE_PREFIX = "ACTLAS_SYSTEM_RESERVATION:";

export function buildReservationSystemMessage(input: {
  type: ReservationSystemMessageType;
  start: Date;
  end?: Date;
  notes?: string | null;
}) {
  const payload: ReservationSystemMessagePayload = {
    type: input.type,
    startTime: input.start.toISOString(),
    endTime: input.end?.toISOString(),
    notes: input.notes || null,
  };
  return `${SYSTEM_MESSAGE_PREFIX}${JSON.stringify(payload)}`;
}

function formatReservationSystemDateTime(payload: ReservationSystemMessagePayload, language: string) {
  const start = new Date(payload.startTime);
  const end = payload.endTime ? new Date(payload.endTime) : null;
  const normalizedLanguage = normalizeReservationLanguage(language);

  const dateFormatter = new Intl.DateTimeFormat(normalizedLanguage === "en" ? "en-US" : "ja-JP", {
    timeZone: TEACHER_TIMEZONE,
    year: "numeric",
    month: normalizedLanguage === "en" ? "long" : "long",
    day: "numeric",
    weekday: "short",
  });
  const timeFormatter = new Intl.DateTimeFormat(normalizedLanguage === "en" ? "en-US" : "ja-JP", {
    timeZone: TEACHER_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const dateText = dateFormatter.format(start);
  const startTimeText = timeFormatter.format(start);
  const endTimeText = end ? timeFormatter.format(end) : "";
  return `${dateText} ${startTimeText}${endTimeText ? `-${endTimeText}` : ""}`;
}

export function localizeReservationSystemMessage(content: string, language: string = "ja") {
  if (!content.startsWith(SYSTEM_MESSAGE_PREFIX)) return content;

  try {
    const payload = JSON.parse(content.slice(SYSTEM_MESSAGE_PREFIX.length)) as ReservationSystemMessagePayload;
    const normalizedLanguage = normalizeReservationLanguage(language);
    const dateTime = formatReservationSystemDateTime(payload, normalizedLanguage);

    const titles: Record<ReservationSystemMessageType, Record<ReservationMessageLanguage, string>> = {
      reservation_confirmed: {
        en: "📅 Lesson reservation confirmed",
        ja: "📅 レッスン予約が確定しました",
      },
      reservation_added_by_teacher: {
        en: "📅 The teacher added a lesson reservation",
        ja: "📅 先生がレッスン予約を追加しました",
      },
      reservation_cancelled: {
        en: "❌ Lesson reservation was cancelled",
        ja: "❌ レッスン予約がキャンセルされました",
      },
      reservation_refund_started: {
        en: "💳 Lesson reservation was cancelled and the refund has been started",
        ja: "💳 レッスン予約をキャンセルし、返金を開始しました",
      },
    };

    const title = titles[payload.type]?.[normalizedLanguage];
    if (!title) return content;

    const notes = payload.notes?.trim()
      ? `\n${normalizedLanguage === "en" ? "Note" : "メモ"}: ${payload.notes.trim()}`
      : "";
    return `${title}\n${dateTime}${notes}`;
  } catch {
    return content;
  }
}

export function localizeReservationSystemMessagePreview(content: string, language: string = "ja") {
  if (!content) return content;
  return localizeReservationSystemMessage(content, language).split("\n")[0] || content;
}
