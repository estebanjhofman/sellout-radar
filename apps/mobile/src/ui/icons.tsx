import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Kleine lijniconen, zodat de app geen iconenfont nodig heeft. */
type P = { size?: number; color: string; filled?: boolean };

export const IconStar = ({ size = 22, color, filled }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
  </Svg>
);

export const IconTicket = ({ size = 22, color, filled }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
    <Path d="M14 7v10" stroke={filled ? '#FFFFFF' : color} strokeWidth={1.4} strokeDasharray="2 2" />
  </Svg>
);

export const IconBell = ({ size = 22, color, filled }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path
      d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
    <Path d="M10 20.5a2 2 0 0 0 4 0" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
  </Svg>
);

export const IconGear = ({ size = 22, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={3.2} stroke={color} strokeWidth={1.8} fill="none" />
    <Path
      d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  </Svg>
);

export const IconList = ({ size = 22, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M8 6h12M8 12h12M8 18h12" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    <Circle cx={4} cy={6} r={1.2} fill={color} />
    <Circle cx={4} cy={12} r={1.2} fill={color} />
    <Circle cx={4} cy={18} r={1.2} fill={color} />
  </Svg>
);

export const IconSearch = ({ size = 18, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M15.5 15.5L21 21" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

export const IconCalendar = ({ size = 16, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x={3.5} y={5} width={17} height={15.5} rx={2.5} stroke={color} strokeWidth={1.8} fill="none" />
    <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);

export const IconLink = ({ size = 14, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const IconArrow = ({ size = 14, color, dir }: P & { dir: 'up' | 'down' | 'flat' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    {dir === 'flat' ? (
      <Path d="M4 12h14M14 7l5 5-5 5" stroke={color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <Path
        d={dir === 'up' ? 'M12 20V5M6 11l6-6 6 6' : 'M12 4v15M6 13l6 6 6-6'}
        stroke={color}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )}
  </Svg>
);

export const IconWarning = ({ size = 16, color }: P) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 3.5L22 20.5H2z" stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" />
    <Path d="M12 10v4.5" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Circle cx={12} cy={17.3} r={1.1} fill={color} />
  </Svg>
);
