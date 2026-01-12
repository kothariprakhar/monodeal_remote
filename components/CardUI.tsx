import React from 'react';
import { Card, COLOR_MAP, RENT_VALUES, SET_LIMITS } from '../types';

interface CardUIProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  isHighlighted?: boolean;
}

const CardUI: React.FC<CardUIProps> = ({ card, onClick, selected, disabled, className, size = 'md', isHighlighted }) => {
  const getCardStyle = () => {
    if (card.type === 'MONEY') return 'bg-emerald-100 text-emerald-900 border-emerald-400';
    if (card.type === 'ACTION') return 'bg-amber-50 text-amber-900 border-amber-400';
    if (card.type === 'RENT') return 'bg-slate-50 text-slate-900 border-slate-300';
    return 'bg-white text-slate-900 border-slate-200';
  };

  // Dynamic styling based on size to ensure proper proportions and avoid overlap
  const getDynamicStyles = () => {
    switch (size) {
      case 'sm':
        return {
          dimensions: 'w-16 h-24',
          // Header is h-1/4 (25% of 96px = 24px). Padding needs to be > 24px. pt-7 is 28px.
          paddingTop: 'pt-7', 
          titleSize: card.type === 'RENT' ? 'text-[6px]' : 'text-[7px]',
          descSize: 'text-[5px]',
          scheduleSize: 'text-[5px]',
          badgeSize: 'w-4 h-4 text-[8px] top-0.5 left-0.5',
          typeSize: 'text-[5px]',
          gap: 'gap-0'
        };
      case 'lg':
        return {
          dimensions: 'w-32 h-48',
          // Header is h-1/4 (25% of 192px = 48px). Padding needs to be > 48px. pt-14 is 56px.
          paddingTop: 'pt-14',
          titleSize: card.type === 'RENT' ? 'text-[11px]' : 'text-[13px]',
          descSize: 'text-[9px]',
          scheduleSize: 'text-[9px]',
          badgeSize: 'w-7 h-7 text-sm top-1.5 left-1.5',
          typeSize: 'text-[9px]',
          gap: 'gap-1'
        };
      case 'md':
      default:
        return {
          dimensions: 'w-24 h-36',
          // Header is h-1/4 (25% of 144px = 36px). Padding needs to be > 36px. pt-10 is 40px.
          paddingTop: 'pt-10',
          titleSize: card.type === 'RENT' ? 'text-[8px]' : 'text-[9px]',
          descSize: 'text-[6px]',
          scheduleSize: 'text-[6px]',
          badgeSize: 'w-5 h-5 text-[10px] top-1 left-1',
          typeSize: 'text-[6px]',
          gap: 'gap-0.5'
        };
    }
  };

  const styles = getDynamicStyles();

  const getHeaderBackground = () => {
    if (card.color === 'ANY') return COLOR_MAP.ANY;
    if (card.color && card.secondaryColor) {
      return `linear-gradient(to right, ${COLOR_MAP[card.color]} 50%, ${COLOR_MAP[card.secondaryColor]} 50%)`;
    }
    return card.color ? COLOR_MAP[card.color] : 'transparent';
  };

  // Extract rent values for the card's color
  const rentInfo = card.color && card.color !== 'ANY' ? RENT_VALUES[card.color] : null;
  const maxSet = card.color && card.color !== 'ANY' ? SET_LIMITS[card.color] : 0;

  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`
        ${styles.dimensions}
        relative rounded-md border-2 transition-all duration-300
        ${selected && !disabled ? '-translate-y-4 ring-4 ring-blue-500 scale-105 z-10 shadow-2xl' : ''}
        ${!selected && !disabled ? 'hover:-translate-y-2 cursor-pointer' : ''}
        ${isHighlighted ? 'ring-4 ring-amber-400 animate-pulse scale-110 z-20' : ''}
        ${disabled ? 'cursor-default' : ''}
        ${getCardStyle()}
        ${className || ''}
        backface-hidden
      `}
      style={{
        transformStyle: 'preserve-3d',
        backfaceVisibility: 'hidden',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        transform: 'translateZ(0)'
      }}
    >
      {/* Property/Rent Header */}
      {(card.type === 'PROPERTY' || card.type === 'WILD' || card.type === 'RENT') && card.color && (
        <div 
          className="absolute top-0 left-0 right-0 h-1/4 rounded-t-sm border-b overflow-hidden"
          style={{ background: getHeaderBackground() }}
        />
      )}

      {/* Value Badge */}
      <div className={`absolute ${styles.badgeSize} rounded-full bg-white/90 flex items-center justify-center font-bold border border-slate-300 shadow-sm z-20`}>
        {card.value}
      </div>

      <div className={`h-full ${styles.paddingTop} flex flex-col items-center p-2 text-center`}>
        <span className={`font-black uppercase tracking-tighter leading-tight mt-1 ${styles.titleSize}`}>
          {card.name}
        </span>
        
        {/* Rent Schedule Section for Properties */}
        {(card.type === 'PROPERTY' || card.type === 'WILD') && rentInfo && (
          <div className={`mt-2 w-full bg-slate-100/50 rounded p-1 flex flex-col ${styles.gap} border border-slate-200`}>
            {rentInfo.map((val, idx) => (
              <div key={idx} className="flex justify-between items-center px-1 font-mono leading-none">
                <span className={`opacity-60 uppercase ${styles.scheduleSize}`}>{idx + 1} {idx + 1 === maxSet ? 'SET' : ''}</span>
                <span className={`font-black ${styles.scheduleSize}`}>{val}M</span>
              </div>
            ))}
          </div>
        )}

        {card.description && (
          <p className={`mt-1 italic opacity-75 font-medium leading-tight px-1 ${styles.descSize}`}>{card.description}</p>
        )}
        
        <div className={`mt-auto opacity-30 font-mono font-bold pb-1 ${styles.typeSize}`}>
          {card.type}
        </div>
      </div>
    </div>
  );
};

export default CardUI;