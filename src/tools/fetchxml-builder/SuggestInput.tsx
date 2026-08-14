import { useState } from "react";

/** Own fixed visual style (border/bg/text/padding), independent of each call site's sizing
 *  class — callers pass sizing/flex classes (e.g. "w-40", "flex-1 min-w-32") via `className`,
 *  which land on the *wrapper* div instead of the `<input>` itself (see below for why). */
const baseInputCls =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:opacity-50";

/** Text input + floating substring-filtered suggestion dropdown — extracted from the combobox
 *  pattern `plugin-registration/StepRegisterDialog.tsx` already hand-rolled for its message
 *  picker (which itself replaced an earlier always-open `<select size={6}>`). Deliberately not a
 *  native `<input list>`/`<datalist>`: that popup is browser/engine-drawn and can't be styled
 *  with CSS, and every other input in this app is carefully dark-mode themed.
 *
 *  `className` sizes the *wrapper* (`w-40`, `flex-1 min-w-32`, etc.) rather than the `<input>`
 *  itself — the input needs `position: relative`'s wrapper to anchor the dropdown, and a
 *  `flex-1`/`w-full` class only affects layout on an element that's actually a flex child, which
 *  the input no longer is once wrapped. */
export default function SuggestInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className = "",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const q = value.trim().toLowerCase();
  const filtered = (q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions).slice(0, 50);

  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        disabled={disabled}
        className={baseInputCls}
      />
      {open && filtered.length > 0 && (
        <ul
          // Stops the input from blurring (and this list from disappearing) before the click
          // below has a chance to register — the classic combobox fix, same as StepRegisterDialog.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-10 mt-1 max-h-48 w-full min-w-40 overflow-y-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {filtered.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
                className="block w-full truncate px-2 py-1 text-left font-mono text-sm text-gray-700 hover:bg-blue-50 dark:text-gray-300 dark:hover:bg-blue-900/20"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
