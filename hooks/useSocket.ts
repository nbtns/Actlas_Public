/**
 * Socket.IO用のReactカスタムフック
 * チャンネルへの接続・メッセージ送受信を管理する
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket, disconnectSocket, type DrawStrokePayload, type LoadOlderMessagesResponse, type SendMessageResponse, type SocketMessage } from "@/lib/socket";
import type { Socket } from "socket.io-client";

/**
 * Socket.IO接続を管理するフック
 * - 接続/切断のライフサイクル管理
 * - チャンネルの参加/退出
 * - メッセージの送受信・編集・削除・ピン留め
 *
 * @param activeChannelId 現在選択中のチャンネルID
 * @param isAuthenticated ログイン確認が完了しているかどうか
 */
export function useSocket(activeChannelId: string | null, isAuthenticated: boolean) {
  const [messagesCache, setMessagesCache] = useState<Record<string, SocketMessage[]>>({});
  const [hasMoreMessagesCache, setHasMoreMessagesCache] = useState<Record<string, boolean>>({});
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const currentChannelRef = useRef<string | null>(null);
  
  // 描画イベントのコールバック保持用
  const drawStrokeCallbackRef = useRef<((data: DrawStrokePayload) => void) | null>(null);
  const clearCanvasCallbackRef = useRef<(() => void) | null>(null);

  // 現在表示すべきメッセージ
  const messages = activeChannelId ? messagesCache[activeChannelId] || [] : [];
  const hasMoreMessages = activeChannelId ? hasMoreMessagesCache[activeChannelId] || false : false;

  // ログイン確認後にSocket接続を開始
  useEffect(() => {
    if (!isAuthenticated) return;

    const socket = getSocket();
    socketRef.current = socket;

    // 接続状態の管理
    const onConnect = () => {
      setIsConnected(true);
      console.log("[Socket] 接続完了");
      // 接続後、現在のチャンネルに再参加
      if (currentChannelRef.current) {
        socket.emit("join_channel", currentChannelRef.current);
      }
    };

    const onDisconnect = () => {
      setIsConnected(false);
      console.log("[Socket] 切断");
    };

    // 認証エラー
    const onAuthError = (data: { message: string }) => {
      console.error("[Socket] 認証エラー:", data.message);
    };

    // チャンネルのメッセージ履歴を受信
    const onChannelMessages = (data: { channelId: string; messages: SocketMessage[]; hasMore?: boolean }) => {
      setMessagesCache((prev) => {
        const existingMsgs = prev[data.channelId] || [];
        const existingIds = new Set(existingMsgs.map(m => m.id));
        const newMsgs = data.messages.filter(m => !existingIds.has(m.id));
        
        // 既存のメッセージと新しいメッセージをマージし、作成日時順にソート（欠損・重複防止）
        const merged = [...existingMsgs, ...newMsgs].sort((a, b) => 
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        return {
          ...prev,
          [data.channelId]: merged,
        };
      });
      if (typeof data.hasMore === "boolean") {
        setHasMoreMessagesCache((prev) => ({
          ...prev,
          [data.channelId]: data.hasMore ?? false,
        }));
      }
    };

    // 新しいメッセージを受信
    const onNewMessage = (message: SocketMessage) => {
      setMessagesCache((prev) => {
        const msgs = prev[message.channelId] || [];
        // 既に同じIDのメッセージが存在する場合は追加しない（重複防止）
        if (msgs.some(m => m.id === message.id)) {
          return prev;
        }
        return {
          ...prev,
          [message.channelId]: [...msgs, message],
        };
      });
    };

    // メッセージ編集を受信
    const onMessageEdited = (data: { channelId: string; messageId: string; content: string }) => {
      setMessagesCache((prev) => {
        const msgs = prev[data.channelId];
        if (!msgs) return prev;
        return {
          ...prev,
          [data.channelId]: msgs.map((m) =>
            m.id === data.messageId ? { ...m, content: data.content, isEdited: true } : m
          ),
        };
      });
    };

    // メッセージ削除を受信
    const onMessageDeleted = (data: { channelId: string; messageId: string }) => {
      setMessagesCache((prev) => {
        const msgs = prev[data.channelId];
        if (!msgs) return prev;
        return {
          ...prev,
          [data.channelId]: msgs.filter((m) => m.id !== data.messageId),
        };
      });
    };

    // ピン留め変更を受信
    const onMessagePinned = (data: { channelId: string; messageId: string; isPinned: boolean }) => {
      setMessagesCache((prev) => {
        const msgs = prev[data.channelId];
        if (!msgs) return prev;
        return {
          ...prev,
          [data.channelId]: msgs.map((m) =>
            m.id === data.messageId ? { ...m, isPinned: data.isPinned } : m
          ),
        };
      });
    };

    // 描画イベントの受信
    const onDrawStroke = (data: DrawStrokePayload) => {
      if (drawStrokeCallbackRef.current) {
        drawStrokeCallbackRef.current(data);
      }
    };
    
    // キャンバスクリアイベントの受信
    const onClearCanvas = () => {
      if (clearCanvasCallbackRef.current) {
        clearCanvasCallbackRef.current();
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("auth_error", onAuthError);
    socket.on("channel_messages", onChannelMessages);
    socket.on("new_message", onNewMessage);
    socket.on("message_edited", onMessageEdited);
    socket.on("message_deleted", onMessageDeleted);
    socket.on("message_pinned", onMessagePinned);
    socket.on("draw_stroke", onDrawStroke);
    socket.on("clear_canvas", onClearCanvas);

    // 認証済みなので接続を開始
    if (!socket.connected) {
      socket.connect();
    } else {
      setIsConnected(true);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("auth_error", onAuthError);
      socket.off("channel_messages", onChannelMessages);
      socket.off("new_message", onNewMessage);
      socket.off("message_edited", onMessageEdited);
      socket.off("message_deleted", onMessageDeleted);
      socket.off("message_pinned", onMessagePinned);
      socket.off("draw_stroke", onDrawStroke);
      socket.off("clear_canvas", onClearCanvas);
    };
  }, [isAuthenticated]);

  // チャンネル切り替え時の処理
  useEffect(() => {
    if (!activeChannelId || !socketRef.current) return;

    currentChannelRef.current = activeChannelId;
    // チラつき防止のため、一旦クリアする処理(setMessages([]))は削除

    if (socketRef.current.connected) {
      socketRef.current.emit("join_channel", activeChannelId);
    }
  }, [activeChannelId]);

  // メッセージ送信（テキスト + ファイルID添付 + 返信対応）
  const sendMessage = useCallback(
    (content: string, fileIds?: string[], replyToId?: string): Promise<SendMessageResponse> => {
      if (!activeChannelId || !socketRef.current) {
        return Promise.resolve({ ok: false, error: "送信先のチャンネルが見つかりません" });
      }
      if (!socketRef.current.connected) {
        return Promise.resolve({ ok: false, error: "サーバーに接続されていません。少し待ってからもう一度送信してください" });
      }
      if (!content.trim() && (!fileIds || fileIds.length === 0)) {
        return Promise.resolve({ ok: false, error: "送信する内容がありません" });
      }

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          resolve({ ok: false, error: "送信の確認がタイムアウトしました。通信状態を確認してください" });
        }, 8000);

        socketRef.current?.emit("send_message", {
          channelId: activeChannelId,
          content: content.trim(),
          fileIds,
          replyToId,
        }, (response: SendMessageResponse) => {
          window.clearTimeout(timer);
          resolve(response);
        });
      });
    },
    [activeChannelId]
  );

  const loadOlderMessages = useCallback((): Promise<LoadOlderMessagesResponse> => {
    if (!activeChannelId || !socketRef.current) {
      return Promise.resolve({ ok: false, error: "チャンネルが見つかりません" });
    }
    if (!socketRef.current.connected) {
      return Promise.resolve({ ok: false, error: "サーバーに接続されていません" });
    }
    if (isLoadingOlder) {
      return Promise.resolve({ ok: false, error: "読み込み中です" });
    }

    const oldestMessage = messagesCache[activeChannelId]?.[0];
    if (!oldestMessage) {
      return Promise.resolve({ ok: false, error: "読み込むメッセージがありません" });
    }

    setIsLoadingOlder(true);
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        setIsLoadingOlder(false);
        resolve({ ok: false, error: "過去のメッセージ読み込みがタイムアウトしました" });
      }, 8000);

      socketRef.current?.emit("load_older_messages", {
        channelId: activeChannelId,
        beforeMessageId: oldestMessage.id,
      }, (response: LoadOlderMessagesResponse) => {
        window.clearTimeout(timer);
        setIsLoadingOlder(false);
        if (response.ok && response.messages) {
          setMessagesCache((prev) => {
            const existingMsgs = prev[activeChannelId] || [];
            const existingIds = new Set(existingMsgs.map(m => m.id));
            const newMsgs = response.messages?.filter(m => !existingIds.has(m.id)) || [];
            const merged = [...existingMsgs, ...newMsgs].sort((a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
            return {
              ...prev,
              [activeChannelId]: merged,
            };
          });
          setHasMoreMessagesCache((prev) => ({
            ...prev,
            [activeChannelId]: response.hasMore ?? false,
          }));
        }
        resolve(response);
      });
    });
  }, [activeChannelId, isLoadingOlder, messagesCache]);

  // メッセージ編集
  const editMessage = useCallback((messageId: string, content: string) => {
    if (!socketRef.current || !content.trim()) return;
    socketRef.current.emit("edit_message", { messageId, content: content.trim() });
  }, []);

  // メッセージ削除
  const deleteMessage = useCallback((messageId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit("delete_message", { messageId });
  }, []);

  // ピン留め/解除
  const pinMessage = useCallback((messageId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit("pin_message", { messageId });
  }, []);

  // ソケット切断（ログアウト時に使用）
  const disconnect = useCallback(() => {
    disconnectSocket();
    socketRef.current = null;
    setIsConnected(false);
    setMessagesCache({});
    setHasMoreMessagesCache({});
    setIsLoadingOlder(false);
  }, []);

  // 描画関連のメソッド
  const sendDrawStroke = useCallback((data: Omit<DrawStrokePayload, "channelId">) => {
    if (!activeChannelId || !socketRef.current) return;
    socketRef.current.emit("draw_stroke", { channelId: activeChannelId, ...data });
  }, [activeChannelId]);

  const sendClearCanvas = useCallback(() => {
    if (!activeChannelId || !socketRef.current) return;
    socketRef.current.emit("clear_canvas", { channelId: activeChannelId });
  }, [activeChannelId]);

  // コールバックの登録
  const setDrawCallbacks = useCallback((onDraw: (data: DrawStrokePayload) => void, onClear: () => void) => {
    drawStrokeCallbackRef.current = onDraw;
    clearCanvasCallbackRef.current = onClear;
  }, []);

  return {
    messages,
    hasMoreMessages,
    isLoadingOlder,
    isConnected,
    sendMessage,
    loadOlderMessages,
    editMessage,
    deleteMessage,
    pinMessage,
    disconnect,
    sendDrawStroke,
    sendClearCanvas,
    setDrawCallbacks
  };
}
