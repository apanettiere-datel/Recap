import React from 'react';
import Svg, { Circle, Rect, Path, Line, G } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
  filled?: boolean;
}

function Icon({ children, size = 22, viewBox = '0 0 24 24' }: { children: React.ReactNode; size: number; viewBox?: string }) {
  return (
    <Svg width={size} height={size} viewBox={viewBox} fill="none">
      {children}
    </Svg>
  );
}

export const WaveformCircleFill = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="11" fill={color} />
    <G stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
      <Line x1="6" y1="12" x2="6" y2="12" />
      <Line x1="8.5" y1="9.5" x2="8.5" y2="14.5" />
      <Line x1="11" y1="7" x2="11" y2="17" />
      <Line x1="13.5" y1="9" x2="13.5" y2="15" />
      <Line x1="16" y1="6" x2="16" y2="18" />
      <Line x1="18.5" y1="10.5" x2="18.5" y2="13.5" />
    </G>
  </Icon>
);

export const Waveform = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <G stroke={color} strokeWidth="1.8" strokeLinecap="round">
      <Line x1="3" y1="12" x2="3" y2="12" />
      <Line x1="6" y1="9" x2="6" y2="15" />
      <Line x1="9" y1="6" x2="9" y2="18" />
      <Line x1="12" y1="3" x2="12" y2="21" />
      <Line x1="15" y1="6" x2="15" y2="18" />
      <Line x1="18" y1="9" x2="18" y2="15" />
      <Line x1="21" y1="12" x2="21" y2="12" />
    </G>
  </Icon>
);

export const MicFill = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="9" y="2.5" width="6" height="12" rx="3" fill={color} />
    <Path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </Icon>
);

export const ListBullet = ({ size = 22, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Circle cx="4" cy="6.5" r="1.3" fill={color} />
    <Circle cx="4" cy="12" r="1.3" fill={color} />
    <Circle cx="4" cy="17.5" r="1.3" fill={color} />
    <Line x1="8.5" y1="6.5" x2="20" y2="6.5" stroke={color} strokeWidth={filled ? 2 : 1.7} strokeLinecap="round" />
    <Line x1="8.5" y1="12" x2="20" y2="12" stroke={color} strokeWidth={filled ? 2 : 1.7} strokeLinecap="round" />
    <Line x1="8.5" y1="17.5" x2="20" y2="17.5" stroke={color} strokeWidth={filled ? 2 : 1.7} strokeLinecap="round" />
  </Icon>
);

export const PersonTwo = ({ size = 22, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Circle cx="9" cy="7.5" r="3.2" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" />
    <Circle cx="17" cy="8.5" r="2.5" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" />
    <Path d="M3 19c0-3 2.7-5.2 6-5.2s6 2.2 6 5.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill={filled ? color : 'none'} />
    <Path d="M15.5 14.5c2.5.3 5 2 5 4.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
  </Icon>
);

export const Lightbulb = ({ size = 22, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 2.5c-3.6 0-6.5 2.8-6.5 6.3 0 2.4 1.3 4.4 3.2 5.6.5.3.8.8.8 1.4V17h5v-1.2c0-.6.3-1.1.8-1.4 1.9-1.2 3.2-3.2 3.2-5.6 0-3.5-2.9-6.3-6.5-6.3z" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    <Path d="M10 19.5h4M10.5 21.5h3" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const ChartBar = ({ size = 22, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Rect x="3.5" y="13" width="4" height="7" rx="1" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" />
    <Rect x="10" y="8" width="4" height="12" rx="1" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" />
    <Rect x="16.5" y="4" width="4" height="16" rx="1" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" />
  </Icon>
);

export const Gear = ({ size = 22, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 3l1 2.2 2.4-.4.6 2.3 2.2 1-.4 2.4 1.6 1.8-1.6 1.8.4 2.4-2.2 1-.6 2.3-2.4-.4L12 21l-1-2.2-2.4.4-.6-2.3-2.2-1 .4-2.4L4.6 12l1.6-1.8-.4-2.4 2.2-1 .6-2.3L11 4.8 12 3z" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
    <Circle cx="12" cy="12" r="3" fill={filled ? '#fff' : 'none'} stroke={color} strokeWidth="1.7" />
  </Icon>
);

export const ChevronRight = ({ size = 14, color = '#000' }: IconProps) => (
  <Icon size={size} viewBox="0 0 24 24">
    <Path d="M9 5l7 7-7 7" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const ChevronLeft = ({ size = 14, color = '#000' }: IconProps) => (
  <Icon size={size} viewBox="0 0 24 24">
    <Path d="M15 5l-7 7 7 7" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const ChevronDown = ({ size = 14, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M5 9l7 7 7-7" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const Xmark = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M5 5l14 14M19 5L5 19" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
  </Icon>
);

export const Plus = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
  </Icon>
);

export const Calendar = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="3" y="5" width="18" height="16" rx="2.5" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M3 10h18M8 3v4M16 3v4" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const CalendarBadgeCheck = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="3" y="5" width="14" height="14" rx="2.5" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M3 10h14M8 3v4" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <Circle cx="18" cy="18" r="5" fill={color} />
    <Path d="M15.5 18.2l1.8 1.8 3.2-3.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const CalendarBadgePlus = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="3" y="5" width="14" height="14" rx="2.5" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M3 10h14M8 3v4" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <Circle cx="18" cy="18" r="5" fill={color} />
    <Path d="M18 15.5v5M15.5 18h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </Icon>
);

export const ArrowRightCircleFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="10" fill={color} />
    <Path d="M9 8l4 4-4 4M9 12h7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const BubbleLeftFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 5h14a2 2 0 012 2v7a2 2 0 01-2 2H9l-4 4v-4H3a2 2 0 01-2-2V7a2 2 0 012-2z" fill={color} />
  </Icon>
);

export const ClockFill = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="10" fill={color} />
    <Path d="M12 6.5V12l3.5 2.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </Icon>
);

export const Clock = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="9.2" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M12 6.5V12l3.5 2.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const CheckmarkCircleFill = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="10" fill={color} />
    <Path d="M7.5 12.4l3 3 6-6.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Icon>
);

export const CircleIcon = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="9.5" stroke={color} strokeWidth="1.7" fill="none" />
  </Icon>
);

export const ExclamationTriangle = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 3l10 17H2L12 3z" fill={color} />
    <Path d="M12 10v5M12 17.5v.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </Icon>
);

export const ArrowClockwise = ({ size = 20, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M20 12a8 8 0 11-2.5-5.8" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
    <Path d="M20 4v4h-4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const Sparkles = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" fill={color} />
    <Path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8L19 14z" fill={color} />
    <Path d="M5 16l.5 1.5 1.5.5-1.5.5L5 20l-.5-1.5L3 18l1.5-.5L5 16z" fill={color} />
  </Icon>
);

export const Target = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="9.2" stroke={color} strokeWidth="1.8" fill="none" />
    <Circle cx="12" cy="12" r="5.5" stroke={color} strokeWidth="1.8" fill="none" />
    <Circle cx="12" cy="12" r="2" fill={color} />
  </Icon>
);

export const TextQuote = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M4 6h4v6c0 2-1 4-4 5M12 6h4v6c0 2-1 4-4 5" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const BubbleLeft = ({ size = 16, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 5h14a2 2 0 012 2v7a2 2 0 01-2 2H9l-4 4v-4H3a2 2 0 01-2-2V7a2 2 0 012-2z" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
  </Icon>
);

export const Search = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth="1.8" fill="none" />
    <Path d="M16 16l5 5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Icon>
);

export const Checklist = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 6l2 2 4-4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Path d="M3 14l2 2 4-4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Path d="M12 6h9M12 15h9" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const EllipsisCircle = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="9.5" stroke={color} strokeWidth="1.7" fill="none" />
    <Circle cx="7" cy="12" r="1.2" fill={color} />
    <Circle cx="12" cy="12" r="1.2" fill={color} />
    <Circle cx="17" cy="12" r="1.2" fill={color} />
  </Icon>
);

export const Trash = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const MagnifyingGlass = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth="2" fill="none" />
    <Path d="M15.5 15.5l5 5" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </Icon>
);

export const XmarkCircleFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="10" fill={color} />
    <Path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
  </Icon>
);

export const ArrowUpCircleFill = ({ size = 28, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="10" fill={color} />
    <Path d="M12 17V7M7.5 11.5L12 7l4.5 4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const Bell = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M5.5 17.5h13c-1.5-1-2-2-2-4.5v-3a4.5 4.5 0 00-9 0v3c0 2.5-.5 3.5-2 4.5z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill="none" />
    <Path d="M10 20.5a2.5 2.5 0 004 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" fill="none" />
    <Path d="M12 4.5V3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Icon>
);

export const ShareSquare = ({ size = 20, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 3v13M7.5 7.5L12 3l4.5 4.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Path d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8" stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" />
  </Icon>
);

export const Tag = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 3h7l11 11-7 7L3 10V3z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
    <Circle cx="7" cy="7" r="1.4" fill={color} />
  </Icon>
);

export const SlidersHoriz = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 6h12M3 12h6M3 18h14" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    <Circle cx="17" cy="6" r="2.4" fill={color} />
    <Circle cx="11" cy="12" r="2.4" fill={color} />
    <Circle cx="6" cy="18" r="2.4" fill={color} />
  </Icon>
);

export const Eye = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke={color} strokeWidth="1.7" fill="none" />
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.7" fill="none" />
  </Icon>
);

export const EyeSlashFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 4l18 16" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <Path d="M2 12s3.5-7 10-7c2 0 3.7.6 5.2 1.5L14 10c-.5-.6-1.2-1-2-1-1.6 0-3 1.4-3 3 0 .8.4 1.5 1 2L6 17c-2.4-1.6-4-5-4-5z" fill={color} />
    <Path d="M9.5 18.5c.8.3 1.6.5 2.5.5 6.5 0 10-7 10-7s-1.4-2.8-4-4.7L9.5 18.5z" fill={color} />
  </Icon>
);

export const StopFill = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="6" y="6" width="12" height="12" rx="2" fill={color} />
  </Icon>
);

export const PlayFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M7 4.5v15l13-7.5-13-7.5z" fill={color} />
  </Icon>
);

export const PauseFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="6" y="4.5" width="4" height="15" rx="1" fill={color} />
    <Rect x="14" y="4.5" width="4" height="15" rx="1" fill={color} />
  </Icon>
);

export const Pencil = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
    <Path d="M14 5l3 3" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const PersonCircleFill = ({ size = 64, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="11" fill={color} />
    <Circle cx="12" cy="10" r="3.5" fill="#fff" />
    <Path d="M5 20.5c1.4-3 4-4.5 7-4.5s5.6 1.5 7 4.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
  </Icon>
);

export const ShieldFill = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z" fill={color} />
    <Path d="M8.5 12l2.5 2.5L16 9.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const PinFill = ({ size = 12, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M11 2l11 11-3 3-5-5-5 9-1-1 5-5-5-5 3-3z" fill={color} />
  </Icon>
);

export const Archive = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="3" y="4" width="18" height="4" rx="1" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
    <Path d="M10 12h4" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const WifiSlash = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 8c2.5-2.5 6-4 9-4 1.5 0 2.9.3 4.2.8M21 8c-1-1-2-1.8-3-2.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    <Path d="M6 12c1-1 2-1.7 3-2.2M15 9.7c1.1.4 2.2 1.2 3 2.3" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    <Circle cx="12" cy="17" r="1.5" fill={color} />
    <Path d="M3 3l18 18" stroke={color} strokeWidth="2" strokeLinecap="round" />
  </Icon>
);

export const CloudUpload = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M6.5 18a4.5 4.5 0 01-1.3-8.8 6 6 0 0111.7-.3A4 4 0 0117 18H13" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
    <Path d="M12 21v-8M9 16l3-3 3 3" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const Doc = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M6 3h8l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
    <Path d="M14 3v5h5" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
  </Icon>
);

export const Copy = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Rect x="8" y="4" width="12" height="14" rx="2" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M5 8H4a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-1" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
  </Icon>
);

export const Star = ({ size = 22, color = '#000', filled }: IconProps) => (
  <Icon size={size}>
    <Path d="M12 3l2.7 6 6.3.8-4.6 4.4 1.3 6.4L12 17.7 6.3 20.6 7.6 14.2 3 9.8 9.3 9 12 3z" fill={filled ? color : 'none'} stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
  </Icon>
);

export const FaceSmiling = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="9.2" stroke={color} strokeWidth="1.7" fill="none" />
    <Circle cx="9" cy="10.5" r="1" fill={color} />
    <Circle cx="15" cy="10.5" r="1" fill={color} />
    <Path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
  </Icon>
);

export const MessageFill = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M4 5h16a2 2 0 012 2v8a2 2 0 01-2 2h-9l-5 4v-4H4a2 2 0 01-2-2V7a2 2 0 012-2z" fill={color} />
  </Icon>
);

export const TextBubble = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 6h14a2 2 0 012 2v6a2 2 0 01-2 2H11l-4 4v-4H4a2 2 0 01-2-2V8a2 2 0 011-2z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" fill="none" />
    <Path d="M6.5 10h8M6.5 13h5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Icon>
);

export const BrainBubble = ({ size = 16, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="12" cy="12" r="10" fill={color} />
    <Path d="M9 8.5c0-1 .8-1.8 1.8-1.8.7 0 1.2.3 1.2.3s.5-.3 1.2-.3c1 0 1.8.8 1.8 1.8 0 .4-.1.7-.3.9.5.3.8.9.8 1.5 0 .8-.5 1.4-1.2 1.6.1.2.2.5.2.7 0 .9-.7 1.6-1.6 1.6h-.4v.5c0 .6-.4 1-1 1s-1-.4-1-1V15h-.4c-.9 0-1.6-.7-1.6-1.6 0-.2.1-.5.2-.7-.7-.2-1.2-.8-1.2-1.6 0-.6.3-1.2.8-1.5-.2-.2-.3-.5-.3-.9z" fill="#fff" />
  </Icon>
);

export const PersonBadgePlus = ({ size = 22, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Circle cx="10" cy="8" r="3.5" stroke={color} strokeWidth="1.7" fill="none" />
    <Path d="M3 19.5c0-3.5 3-5.5 7-5.5 1 0 1.9.1 2.7.4" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    <Path d="M19 14v6M16 17h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Icon>
);

export const ChartXY = ({ size = 18, color = '#000' }: IconProps) => (
  <Icon size={size}>
    <Path d="M3 4v16h18" stroke={color} strokeWidth="1.7" strokeLinecap="round" fill="none" />
    <Path d="M6 16l4-5 3 3 6-7" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </Icon>
);
