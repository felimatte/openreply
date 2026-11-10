import { useRef, type ChangeEvent, type ComponentPropsWithoutRef } from "react";
import { useI18n } from "@/lib/i18n/provider";
import EmojiPicker from "@/components/emoji-picker";

type InputProps = Omit<ComponentPropsWithoutRef<"input">, "onChange" | "type" | "value"> & { rows?: never };
type TextareaProps = Omit<ComponentPropsWithoutRef<"textarea">, "onChange" | "value"> & { rows: number };
type MessageFieldProps = (InputProps | TextareaProps) & {
  value: string;
  onValueChange: (value: string) => void;
  pickerAbove?: boolean;
};

export default function MessageField({
  value, onValueChange, pickerAbove, className = "", ...control
}: MessageFieldProps) {
  const { t } = useI18n();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const setField = (field: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRef.current = field;
  };
  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onValueChange(event.currentTarget.value);
  };
  const fieldClass = `min-w-0 ${className}`;

  return (
    <div className="relative grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
      {control.rows === undefined
        ? <input {...control} ref={setField} className={fieldClass} value={value} onChange={onChange} />
        : <textarea {...control} ref={setField} className={fieldClass} value={value} onChange={onChange} />}
      <EmojiPicker
        fieldRef={fieldRef}
        label={t("Add emoji")}
        value={value}
        onValueChange={onValueChange}
        maxLength={control.maxLength}
        disabled={control.disabled}
        above={pickerAbove}
      />
    </div>
  );
}
