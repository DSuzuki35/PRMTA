export type ControllerContext = { blocked: boolean; assigning: boolean };
export type ControllerPad = {
  index: number;
  id: string;
  name: string;
  mapping: 'standard' | 'raw';
  buttons: { pressed: boolean }[];
};
export type ControllerState = {
  status: 'ready' | 'error' | 'unsupported';
  backend: 'sdl';
  message: string;
  pads: ControllerPad[];
  /** Only true when native initialization failed permanently; never for poll errors. */
  fallback?: boolean;
};
