
import { Card, PropertyColor } from './types';

const createCard = (name: string, type: any, value: number, color?: PropertyColor, desc?: string, secondaryColor?: PropertyColor): Card => ({
  id: `${name}-${Math.random().toString(36).substr(2, 9)}`,
  name,
  type,
  value,
  color,
  secondaryColor,
  description: desc
});

export const INITIAL_DECK: Card[] = [
  // Money Cards
  ...Array(1).fill(null).map(() => createCard('10M', 'MONEY', 10)),
  ...Array(2).fill(null).map(() => createCard('5M', 'MONEY', 5)),
  ...Array(3).fill(null).map(() => createCard('4M', 'MONEY', 4)),
  ...Array(3).fill(null).map(() => createCard('3M', 'MONEY', 3)),
  ...Array(5).fill(null).map(() => createCard('2M', 'MONEY', 2)),
  ...Array(6).fill(null).map(() => createCard('1M', 'MONEY', 1)),

  // Action Cards
  ...Array(2).fill(null).map(() => createCard('Deal Breaker', 'ACTION', 7, undefined, 'Steal a complete set from any player.')),
  ...Array(3).fill(null).map(() => createCard('Sly Deal', 'ACTION', 3, undefined, 'Steal a single property from any player.')),
  ...Array(3).fill(null).map(() => createCard('Force Deal', 'ACTION', 3, undefined, 'Swap a property with another player.')),
  ...Array(3).fill(null).map(() => createCard('Just Say No', 'ACTION', 4, undefined, 'Counter any action card.')),
  ...Array(3).fill(null).map(() => createCard('Debt Collector', 'ACTION', 3, undefined, 'Collect 5M from one player.')),
  ...Array(3).fill(null).map(() => createCard("It's My Birthday", 'ACTION', 2, undefined, 'Collect 2M from all players.')),
  ...Array(10).fill(null).map(() => createCard('Pass Go', 'ACTION', 1, undefined, 'Draw 2 extra cards.')),

  // Rent Cards
  createCard('Rent (Brown/L.Blue)', 'RENT', 1, 'BROWN', 'Collect rent for Brown or Light Blue sets.', 'LIGHT_BLUE'),
  createCard('Rent (Brown/L.Blue)', 'RENT', 1, 'BROWN', 'Collect rent for Brown or Light Blue sets.', 'LIGHT_BLUE'),
  createCard('Rent (Pink/Orange)', 'RENT', 1, 'PINK', 'Collect rent for Pink or Orange sets.', 'ORANGE'),
  createCard('Rent (Pink/Orange)', 'RENT', 1, 'PINK', 'Collect rent for Pink or Orange sets.', 'ORANGE'),
  createCard('Rent (Red/Yellow)', 'RENT', 1, 'RED', 'Collect rent for Red or Yellow sets.', 'YELLOW'),
  createCard('Rent (Red/Yellow)', 'RENT', 1, 'RED', 'Collect rent for Red or Yellow sets.', 'YELLOW'),
  createCard('Rent (Green/D.Blue)', 'RENT', 1, 'GREEN', 'Collect rent for Green or Dark Blue sets.', 'DARK_BLUE'),
  createCard('Rent (Green/D.Blue)', 'RENT', 1, 'GREEN', 'Collect rent for Green or Dark Blue sets.', 'DARK_BLUE'),
  createCard('Rent (Rail/Util)', 'RENT', 1, 'RAILROAD', 'Collect rent for Railroad or Utility sets.', 'UTILITY'),
  createCard('Rent (Rail/Util)', 'RENT', 1, 'RAILROAD', 'Collect rent for Railroad or Utility sets.', 'UTILITY'),
  ...Array(3).fill(null).map(() => createCard('Any Rent', 'RENT', 3, 'ANY', 'Collect rent for ANY color set.')),

  // Properties
  ...Array(2).fill(null).map(() => createCard('Old Kent Road', 'PROPERTY', 1, 'BROWN')),
  ...Array(3).fill(null).map(() => createCard('The Angel Islington', 'PROPERTY', 1, 'LIGHT_BLUE')),
  ...Array(3).fill(null).map(() => createCard('Whitehall', 'PROPERTY', 2, 'PINK')),
  ...Array(3).fill(null).map(() => createCard('Bow Street', 'PROPERTY', 2, 'ORANGE')),
  ...Array(3).fill(null).map(() => createCard('Fleet Street', 'PROPERTY', 3, 'RED')),
  ...Array(3).fill(null).map(() => createCard('Leicester Square', 'PROPERTY', 3, 'YELLOW')),
  ...Array(3).fill(null).map(() => createCard('Bond Street', 'PROPERTY', 4, 'GREEN')),
  ...Array(2).fill(null).map(() => createCard('Park Lane', 'PROPERTY', 4, 'DARK_BLUE')),
  ...Array(4).fill(null).map(() => createCard('King\'s Cross Station', 'PROPERTY', 2, 'RAILROAD')),
  ...Array(2).fill(null).map(() => createCard('Water Works', 'PROPERTY', 2, 'UTILITY')),

  // Wildcards
  createCard('Dark Blue/Green Wild', 'WILD', 4, 'DARK_BLUE', 'Use as Dark Blue or Green property.', 'GREEN'),
  createCard('Light Blue/Brown Wild', 'WILD', 1, 'LIGHT_BLUE', 'Use as Light Blue or Brown property.', 'BROWN'),
];
