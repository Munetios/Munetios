"use client";

import { useState } from "react";
import { ColorControl } from "./accountAppearanceSection";
import { showModal } from "./modal";

const defaultColors = [
  "#000000",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0ea5e9",
  "#2563eb",
  "#7c3aed",
  "#ec4899",
];

function ColorPickerModalContent({ close, copy, initialValue, onSelect }) {
  const [color, setColor] = useState(initialValue);
  const [customColors, setCustomColors] = useState([]);
  return (
    <div className="space-y-3">
      <ColorControl
        colors={[...defaultColors, ...customColors]}
        copy={copy}
        label={copy.accountAppearanceAccentColor}
        onAddColor={(nextColor) =>
          setCustomColors((current) =>
            current.includes(nextColor) ? current : [...current, nextColor],
          )
        }
        onChange={setColor}
        value={color}
      />
      <div className="flex justify-end gap-2">
        <button
          className="rounded-xl border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10!"
          onClick={close}
          type="button"
        >
          {copy.cancel}
        </button>
        <button
          className="liquid-glass rounded-xl border border-purple-200/20 bg-purple-600/35! px-3 py-2 text-sm font-bold"
          onClick={() => {
            onSelect(color);
            close();
          }}
          type="button"
        >
          {copy.businessFeedbackDone}
        </button>
      </div>
    </div>
  );
}

export function openColorPickerModal({ copy, onSelect, value = "#000000" }) {
  return showModal(
    ({ close }) => (
      <ColorPickerModalContent
        close={close}
        copy={copy}
        initialValue={value}
        onSelect={onSelect}
      />
    ),
    {
      ariaLabel: copy.accountAppearanceOpenColorPicker,
      title: copy.accountAppearanceOpenColorPicker,
      width: "min(430px, 100%)",
    },
  );
}
