import type { Server as SocketIOServer } from "socket.io";

declare global {
  var actlasRealtimeServer: SocketIOServer | undefined;
}

export function setRealtimeServer(io: SocketIOServer): void {
  globalThis.actlasRealtimeServer = io;
}

export function getRealtimeServer(): SocketIOServer | null {
  return globalThis.actlasRealtimeServer ?? null;
}
