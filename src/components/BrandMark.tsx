import React from 'react';
import type { WorkshopProfile } from '../types/workshop';

interface BrandMarkProps {
  profile?: Partial<WorkshopProfile> | null;
  size?: 'sm' | 'md' | 'lg';
  showLogoImage?: boolean;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  profile,
  size = 'md',
  showLogoImage = true,
}) => {
  const brandName = (profile?.brandName || 'TH3 BNB').trim();
  const words = brandName.split(/\s+/).filter(Boolean);
  const wordColors = profile?.wordColors || [];
  const logoDataUrl = profile?.logoDataUrl;
  const logoScale = profile?.logoScale ?? 100;
  const logoTransparent = profile?.logoTransparent ?? true;

  const textSize =
    size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg';

  if (showLogoImage && logoDataUrl) {
    const baseHeight = size === 'sm' ? 28 : size === 'lg' ? 48 : 34;
    const heightPx = Math.round((baseHeight * Math.min(200, Math.max(60, logoScale))) / 100);
    return (
      <div
        className={`inline-flex items-center shrink-0 ${
          logoTransparent ? '' : 'rounded-lg bg-white px-2 py-1 shadow-xs'
        }`}
      >
        <img
          src={logoDataUrl}
          alt={brandName}
          referrerPolicy="no-referrer"
          style={{ height: `${heightPx}px`, maxWidth: '180px' }}
          className="object-contain"
        />
      </div>
    );
  }

  return (
    <span className={`font-display font-extrabold tracking-tight whitespace-nowrap shrink-0 ${textSize}`}>
      {words.map((word, idx) => {
        const customColor = wordColors[idx];
        const fallbackClass =
          idx === 0
            ? 'text-slate-900 dark:text-white'
            : 'text-[#0072BB] dark:text-sky-400';
        return (
          <React.Fragment key={`${word}-${idx}`}>
            {idx > 0 && ' '}
            <span
              className={customColor ? undefined : fallbackClass}
              style={customColor ? { color: customColor } : undefined}
            >
              {word}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
};
