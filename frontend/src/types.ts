export type Prize = {
  id: number;
  slot: number;
  name: string;
  description: string;
  icon: string;
  color: string;
};

export type SpinHistory = {
  id: string;
  prize: Prize;
  createdAt: string;
};

export type Session = {
  user: {
    id: number;
    username: string;
    displayName: string;
  };
  remainingCoupons: number;
  history: SpinHistory[];
};

export type SpinResult = {
  spinId: string;
  requestId: string;
  prize: Prize;
  remainingCoupons: number;
  createdAt: string;
  replayed: boolean;
};

export type SpinPhase = "idle" | "requesting" | "animating" | "recovering";
