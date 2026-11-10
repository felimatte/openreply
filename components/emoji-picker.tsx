import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

const emojis = [
  "😀", "😊", "😂", "😍", "🥰", "😎",
  "😉", "🤔", "😅", "🙌", "👏", "👍",
  "🙏", "👋", "💪", "❤️", "🔥", "✨",
  "🎉", "🚀", "✅", "👀", "👇", "📩",
  "💬", "📲", "💡", "🎁", "💯", "⚡",
];

type EmojiPickerProps = {
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  maxLength?: number;
  above?: boolean;
};

export default function EmojiPicker({
  fieldRef, label, value, onValueChange, disabled, maxLength, above,
}: EmojiPickerProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const caret = useRef<number | null>(null);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const open = selection !== null && !disabled;
  const remaining = maxLength === undefined || maxLength < 0 || !selection
    ? Infinity
    : maxLength - value.length + selection.end - selection.start;

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || caret.current === null) return;
    const position = caret.current;
    caret.current = null;
    field.focus();
    field.setSelectionRange(position, position);
  }, [fieldRef, selection]);

  function toggle() {
    const field = fieldRef.current;
    if (!field) return;
    const start = field.selectionStart ?? value.length;
    const end = field.selectionEnd ?? start;
    trigger.current?.focus();
    setSelection(open ? null : { start, end });
  }

  function insert(emoji: string) {
    if (!open || !selection || emoji.length > remaining) return;
    const { start, end } = selection;
    caret.current = start + emoji.length;
    setSelection(null);
    onValueChange(value.slice(0, start) + emoji + value.slice(end));
  }

  return (
    <div
      className="contents"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setSelection(null);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          trigger.current?.focus();
          setSelection(null);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={toggle}
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01m5.99 0h.01" />
        </svg>
      </button>
      {open && (
        <div
          id={id}
          role="group"
          aria-label={label}
          className={`grid w-56 max-w-full grid-cols-[repeat(auto-fit,minmax(32px,1fr))] gap-0.5 rounded-xl border border-border bg-surface p-2 shadow-lg ${above ? "absolute right-0 bottom-full z-30 mb-1 max-h-52 overflow-y-auto" : "col-span-full justify-self-end"}`}
        >
          {emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              disabled={emoji.length > remaining}
              className="h-9 rounded-md text-lg hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
