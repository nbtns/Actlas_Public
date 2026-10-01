-- CreateEnum
CREATE TYPE "Role" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('GUIDE', 'CHAT', 'MATERIAL', 'LESSON_RECORD', 'BOOKING', 'MEMO', 'DASHBOARD', 'YOUTUBE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'REFUNDED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "avatarUrl" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "two_factor_code" TEXT,
    "two_factor_expires_at" TIMESTAMP(3),
    "two_factor_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "two_factor_resend_count" INTEGER NOT NULL DEFAULT 0,
    "two_factor_last_sent_at" TIMESTAMP(3),
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "birth_date" TIMESTAMP(3),
    "gender" TEXT,
    "hobbies" TEXT,
    "favorite_artists" TEXT,
    "goals" TEXT,
    "total_lessons" INTEGER NOT NULL DEFAULT 0,
    "special_offer_eligible" BOOLEAN NOT NULL DEFAULT false,
    "is_first_login" BOOLEAN NOT NULL DEFAULT true,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "language" TEXT NOT NULL DEFAULT 'ja',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_message" TEXT,
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL DEFAULT 'CHAT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "teacher_only" BOOLEAN NOT NULL DEFAULT false,
    "icon" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "room_id" TEXT NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "author_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "reply_to_id" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "teacher_id" TEXT NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reactions" (
    "id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcement_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,

    CONSTRAINT "announcement_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_read_states" (
    "id" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "teacher_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "announcement_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_deliveries" (
    "id" TEXT NOT NULL,
    "event_kind" TEXT NOT NULL,
    "title_ja" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "body_ja" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "announcement_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,

    CONSTRAINT "announcement_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "stripe_session_id" TEXT,
    "stripe_payment_id" TEXT,
    "stripe_connected_account_id" TEXT,
    "amount_paid" INTEGER,
    "student_id" TEXT NOT NULL,
    "lesson_menu_id" TEXT,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "user_id" TEXT NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_reminders" (
    "id" TEXT NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_error" TEXT,
    "reservation_id" TEXT NOT NULL,

    CONSTRAINT "reservation_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channel_states" (
    "id" TEXT NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,

    CONSTRAINT "notification_channel_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_slots" (
    "id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "teacher_id" TEXT NOT NULL,

    CONSTRAINT "blocked_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_records" (
    "id" TEXT NOT NULL,
    "summary" TEXT,
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservation_id" TEXT NOT NULL,

    CONSTRAINT "lesson_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translation_logs" (
    "id" TEXT NOT NULL,
    "original_text" TEXT NOT NULL,
    "translated_text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lesson_record_id" TEXT NOT NULL,

    CONSTRAINT "translation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "message_id" TEXT,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_profiles" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "photo_url" TEXT,
    "photo_position_x" INTEGER NOT NULL DEFAULT 50,
    "photo_position_y" INTEGER NOT NULL DEFAULT 50,
    "photo_zoom" INTEGER NOT NULL DEFAULT 100,
    "stripe_connected_account_id" TEXT,
    "stripe_connected_livemode" BOOLEAN,
    "stripe_connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_menus" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "special_price" INTEGER,
    "duration" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "profile_id" TEXT NOT NULL,

    CONSTRAINT "lesson_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_law_infos" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "business_hours" TEXT,
    "price_explanation" TEXT,
    "payment_methods" TEXT,
    "delivery_time" TEXT,
    "cancellation_policy" TEXT NOT NULL,
    "terms_of_service_en" TEXT,
    "refund_policy_en" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "profile_id" TEXT NOT NULL,

    CONSTRAINT "commercial_law_infos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_student_id_key" ON "rooms"("student_id");

-- CreateIndex
CREATE INDEX "announcements_teacher_id_created_at_idx" ON "announcements"("teacher_id", "created_at");

-- CreateIndex
CREATE INDEX "announcement_reactions_announcement_id_emoji_idx" ON "announcement_reactions"("announcement_id", "emoji");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reactions_announcement_id_student_id_emoji_key" ON "announcement_reactions"("announcement_id", "student_id", "emoji");

-- CreateIndex
CREATE INDEX "announcement_read_states_user_id_notified_at_idx" ON "announcement_read_states"("user_id", "notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_read_states_teacher_id_user_id_key" ON "announcement_read_states"("teacher_id", "user_id");

-- CreateIndex
CREATE INDEX "announcement_deliveries_delivered_at_attempts_created_at_idx" ON "announcement_deliveries"("delivered_at", "attempts", "created_at");

-- CreateIndex
CREATE INDEX "announcement_deliveries_recipient_id_delivered_at_idx" ON "announcement_deliveries"("recipient_id", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_stripe_session_id_key" ON "reservations"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_stripe_payment_id_key" ON "reservations"("stripe_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reservation_reminders_reservation_id_offset_minutes_key" ON "reservation_reminders"("reservation_id", "offset_minutes");

-- CreateIndex
CREATE INDEX "notification_channel_states_user_id_notified_at_idx" ON "notification_channel_states"("user_id", "notified_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_channel_states_user_id_channel_id_key" ON "notification_channel_states"("user_id", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_records_reservation_id_key" ON "lesson_records"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_username_key" ON "teacher_profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_profiles_user_id_key" ON "teacher_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_law_infos_profile_id_key" ON "commercial_law_infos"("profile_id");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reactions" ADD CONSTRAINT "announcement_reactions_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reactions" ADD CONSTRAINT "announcement_reactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_read_states" ADD CONSTRAINT "announcement_read_states_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_read_states" ADD CONSTRAINT "announcement_read_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_lesson_menu_id_fkey" FOREIGN KEY ("lesson_menu_id") REFERENCES "lesson_menus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_reminders" ADD CONSTRAINT "reservation_reminders_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channel_states" ADD CONSTRAINT "notification_channel_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channel_states" ADD CONSTRAINT "notification_channel_states_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_slots" ADD CONSTRAINT "blocked_slots_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_records" ADD CONSTRAINT "lesson_records_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translation_logs" ADD CONSTRAINT "translation_logs_lesson_record_id_fkey" FOREIGN KEY ("lesson_record_id") REFERENCES "lesson_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_menus" ADD CONSTRAINT "lesson_menus_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commercial_law_infos" ADD CONSTRAINT "commercial_law_infos_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "teacher_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

