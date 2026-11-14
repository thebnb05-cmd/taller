import React from 'react';
import type { WorkshopProfile } from '../types/workshop';

interface BrandMarkProps {
  profile?: Partial<WorkshopProfile> | null;
  size?: 'sm' | 'md' | 'lg';
  showLogoImage?: boolean;
  forceLight?: boolean;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

function getRelativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function toDarkModeWordColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed.toLowerCase() === '#0072bb') return '#38BDF8';
  const rgb = parseHexColor(trimmed);
  if (!rgb) return '#F8FAFC';
  const lum = getRelativeLuminance(rgb.r, rgb.g, rgb.b);
  if (lum >= 0.36) return trimmed;
  const maxCh = Math.max(rgb.r, rgb.g, rgb.b);
  const minCh = Math.min(rgb.r, rgb.g, rgb.b);
  if (lum < 0.08 && maxCh - minCh < 35) {
    return '#F8FAFC';
  }
  const mix = lum < 0.15 ? 0.55 : 0.42;
  const r = Math.round(rgb.r + (255 - rgb.r) * mix);
  const g = Math.round(rgb.g + (255 - rgb.g) * mix);
  const b = Math.round(rgb.b + (255 - rgb.b) * mix);
  return `rgb(${r}, ${g}, ${b})`;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  profile,
  size = 'md',
  showLogoImage = true,
  forceLight = false,
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
          logoTransparent
            ? forceLight
              ? ''
              : 'dark:rounded-lg dark:bg-white/95 dark:px-2 dark:py-0.5'
            : 'rounded-lg bg-white px-2 py-1 shadow-xs'
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
            ? forceLight
              ? 'text-slate-900'
              : 'text-slate-900 dark:text-white'
            : forceLight
            ? 'text-[#0072BB]'
            : 'text-[#0072BB] dark:text-sky-400';

        const darkColor = customColor
          ? forceLight
            ? customColor
            : toDarkModeWordColor(customColor)
          : undefined;

        return (
          <React.Fragment key={`${word}-${idx}`}>
            {idx > 0 && ' '}
            <span
              className={
                customColor
                  ? forceLight
                    ? 'text-(--brand-light)'
                    : 'text-(--brand-light) dark:text-(--brand-dark)'
                  : fallbackClass
              }
              style={
                customColor
                  ? ({
                      '--brand-light': customColor,
                      '--brand-dark': darkColor,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              {word}
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
};
