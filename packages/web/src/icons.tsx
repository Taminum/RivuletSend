// Minimal inline SVG icons (stroke-based, currentColor) for the sidebar and views.
type IconProps = { size?: number; className?: string };

function svg(children: React.ReactNode, size = 20, className?: string) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const SendIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </>,
    size,
    className,
  );

export const ReceiveIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </>,
    size,
    className,
  );

export const ContactsIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
    size,
    className,
  );

export const HistoryIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l4 2" />
    </>,
    size,
    className,
  );

export const SettingsIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
    </>,
    size,
    className,
  );

export const CollapseIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </>,
    size,
    className,
  );

export const CloudUploadIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M4 14.9A5 5 0 0 1 6 5.5a6 6 0 0 1 11.6 1.6A4.5 4.5 0 0 1 18 16" />
      <path d="M12 12v8" />
      <path d="M8.5 15.5 12 12l3.5 3.5" />
    </>,
    size,
    className,
  );

export const FileIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </>,
    size,
    className,
  );

export const TextIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M4 7V5h16v2" />
      <path d="M9 20h6" />
      <path d="M12 5v15" />
    </>,
    size,
    className,
  );

export const FolderIcon = ({ size, className }: IconProps) =>
  svg(
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
    size,
    className,
  );

export const CopyIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
    size,
    className,
  );

export const CheckIcon = ({ size, className }: IconProps) =>
  svg(<path d="M20 6 9 17l-5-5" />, size, className);

export const XIcon = ({ size, className }: IconProps) =>
  svg(
    <>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </>,
    size,
    className,
  );
