
export type PropertyColor = 
  | 'BROWN' 
  | 'LIGHT_BLUE' 
  | 'PINK' 
  | 'ORANGE' 
  | 'RED' 
  | 'YELLOW' 
  | 'GREEN' 
  | 'DARK_BLUE' 
  | 'RAILROAD' 
  | 'UTILITY'
  | 'ANY';

export type CardType = 'PROPERTY' | 'ACTION' | 'RENT' | 'MONEY' | 'WILD';

export interface Card {
  id: string;
  name: string;
  type: CardType;
  value: number;
  color?: PropertyColor;
  secondaryColor?: PropertyColor; // For multi-color wildcards
  description?: string;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  bank: Card[];
  properties: PropertySet[];
  isAI: boolean;
}

export interface PropertySet {
  color: PropertyColor;
  cards: Card[];
  isComplete: boolean;
}

export type GamePhase = 'LOBBY' | 'START_TURN' | 'PLAY_PHASE' | 'END_TURN' | 'GAME_OVER';

export interface PendingAction {
  type: 'FORCE_DEAL' | 'SLY_DEAL' | 'DEAL_BREAKER' | 'RENT_ALL' | 'DEBT_COLLECTOR' | 'BIRTHDAY';
  card: Card;
  attackerIndex: number;
  targetIndex?: number; // For single target actions
  targetSetIndex?: number;
  mySetIndex?: number;
  jsnStack?: number; // 0 = Action Active, 1 = Blocked by JSN, 2 = Countered JSN (Active), etc.
}

export interface GameState {
  players: Player[];
  activePlayerIndex: number;
  deck: Card[];
  discardPile: Card[];
  phase: GamePhase;
  actionsRemaining: number;
  logs: string[];
  winner: string | null;
  multiplayerRole?: 'HOST' | 'JOINER';
  pendingAction: PendingAction | null;
}

export const COLOR_MAP: Record<PropertyColor, string> = {
  BROWN: '#8B4513',
  LIGHT_BLUE: '#87CEEB',
  PINK: '#FF69B4',
  ORANGE: '#FFA500',
  RED: '#FF0000',
  YELLOW: '#FFFF00',
  GREEN: '#008000',
  DARK_BLUE: '#00008B',
  RAILROAD: '#000000',
  UTILITY: '#F5F5DC',
  ANY: 'linear-gradient(45deg, #ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ec4899)'
};

export const SET_LIMITS: Record<PropertyColor, number> = {
  BROWN: 2,
  LIGHT_BLUE: 3,
  PINK: 3,
  ORANGE: 3,
  RED: 3,
  YELLOW: 3,
  GREEN: 3,
  DARK_BLUE: 2,
  RAILROAD: 4,
  UTILITY: 2,
  ANY: 999
};

export const RENT_VALUES: Record<PropertyColor, number[]> = {
  BROWN: [1, 2],
  LIGHT_BLUE: [1, 2, 3],
  PINK: [1, 2, 4],
  ORANGE: [1, 3, 5],
  RED: [2, 3, 6],
  YELLOW: [2, 4, 6],
  GREEN: [2, 4, 7],
  DARK_BLUE: [3, 8],
  RAILROAD: [1, 2, 3, 4],
  UTILITY: [1, 2],
  ANY: [0] // Special case
};
