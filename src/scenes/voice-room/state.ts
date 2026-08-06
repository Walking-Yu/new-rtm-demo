export type EndpointRole = 'host' | 'audience';
export type SeatStatus = 'empty' | 'joining' | 'active' | 'muted';

export interface SeatState {
  seatId: string;
  userId?: string;
  displayName?: string;
  status: SeatStatus;
  muted: boolean;
}

export interface SeatRequest {
  id: string;
  userId: string;
  displayName: string;
  seatId: string;
  createdAt: number;
}

export interface SeatInvitation extends SeatRequest {
  hostUserId: string;
}

export interface VoiceRoomSnapshot {
  revision: number;
  hostUserId: string;
  announcement: string;
  seats: Record<string, SeatState>;
  queue: SeatRequest[];
  invitation: SeatInvitation | null;
  bannedUserIds: string[];
}
