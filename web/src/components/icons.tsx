/**
 * Hand-picked 24×24 stroke icons (Feather-style geometry, drawn here so the app ships no
 * icon-font or third-party dependency). All of them inherit `currentColor`.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  )
}

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 13a9 9 0 0 1 18 0" />
    <path d="M12 13l4-3.5" />
    <circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" />
    <path d="M3 13v3.5h18V13" />
  </Svg>
)

export const IconTypes = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8.5 4.5L12 12 3.5 7.5 12 3Z" />
    <path d="m3.5 12 8.5 4.5L20.5 12" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  </Svg>
)

export const IconSpool = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21" />
  </Svg>
)

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
  </Svg>
)

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
)

export const IconClose = (p: IconProps) => (
  <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>
)

export const IconPrinter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 9V3.8h10V9" />
    <path d="M7 18H5.5A2.5 2.5 0 0 1 3 15.5v-4A2.5 2.5 0 0 1 5.5 9h13a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H17" />
    <rect x="7" y="14.5" width="10" height="5.7" rx="1" />
  </Svg>
)

export const IconScale = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5v15" />
    <path d="M6.5 19.5h11" />
    <path d="M4 9h16" />
    <path d="M7.5 9 4.5 15h6L7.5 9ZM16.5 9l-3 6h6l-3-6Z" />
  </Svg>
)

export const IconBox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 7.6v8.8a1.6 1.6 0 0 1-.85 1.4l-6.9 3.7a1.6 1.6 0 0 1-1.5 0l-6.9-3.7a1.6 1.6 0 0 1-.85-1.4V7.6" />
    <path d="m3.9 6.6 7.35-3.9a1.6 1.6 0 0 1 1.5 0l7.35 3.9-7.35 3.9a1.6 1.6 0 0 1-1.5 0L3.9 6.6Z" />
    <path d="M12 10.9v9.9" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.2 12.2 2.6 2.6 5-5.4" />
  </Svg>
)

export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.8 6.2a4.4 4.4 0 0 0 5.6 5.6l-8.2 8.2a2.3 2.3 0 0 1-3.3-3.3l8.2-8.2Z" />
    <path d="M14.8 6.2 17.6 3.4" />
  </Svg>
)

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>
)

export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 16.5v-4M12.5 16.5v-8M17 16.5v-5.5" />
  </Svg>
)

export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.2 4.6v4h4" />
    <path d="M12 8v4.4l3 1.8" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.8h5v1.7" />
    <path d="M6.7 6.5 7.5 19a1.4 1.4 0 0 0 1.4 1.3h6.2A1.4 1.4 0 0 0 16.5 19l.8-12.5" />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 4.2 2.9 17.4a1.6 1.6 0 0 0 1.4 2.4h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.2a1.6 1.6 0 0 0-2.8 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Svg>
)

export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 13.5h4l1.3 2.4h6.4l1.3-2.4h4" />
    <path d="M6.1 4.6h11.8a1.6 1.6 0 0 1 1.45.93l2.15 4.6v7.9a1.6 1.6 0 0 1-1.6 1.6H4.1a1.6 1.6 0 0 1-1.6-1.6v-7.9l2.15-4.6a1.6 1.6 0 0 1 1.45-.93Z" />
  </Svg>
)
