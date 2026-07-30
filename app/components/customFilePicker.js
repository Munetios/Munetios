"use client";

import { useEffect, useRef, useState } from "react";

export default function CustomFilePicker({
  accept = "image/png,image/jpeg,image/webp",
  copy,
  maximumBytes = 500 * 1024 * 1024,
  onChange,
  preview = "",
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [localPreview, setLocalPreview] = useState("");

  useEffect(
    () => () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    },
    [localPreview],
  );

  const chooseFile = (file) => {
    if (!file) return;
    const allowedTypes = accept.split(",").map((type) => type.trim());
    if (!allowedTypes.includes(file.type) || file.size > maximumBytes) {
      onChange?.({ error: "invalid_file", file: null, value: "" });
      return;
    }
    if (localPreview) URL.revokeObjectURL(localPreview);
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);
    setFileName(file.name);
    onChange?.({ error: "", file, value: "" });
  };
  const shownPreview = localPreview || preview;

  return (
    <div className="space-y-2">
      <button
        aria-label={copy.filePickerChoose}
        className={`liquid-glass grid min-h-40 w-full place-items-center overflow-hidden rounded-2xl border border-dashed p-4 text-center transition ${
          dragging
            ? "border-purple-200/70 bg-purple-500/25!"
            : "border-white/20 bg-white/6! hover:border-purple-200/45 hover:bg-purple-500/12!"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          chooseFile(event.dataTransfer.files?.[0]);
        }}
        type="button"
      >
        {shownPreview ? (
          <span className="grid gap-3">
            <img
              alt={copy.filePickerPreview}
              className="mx-auto h-20 w-20 rounded-2xl object-cover"
              src={shownPreview}
            />
            <span className="text-sm font-semibold">
              {fileName || copy.filePickerReplace}
            </span>
          </span>
        ) : (
          <span className="grid justify-items-center gap-2">
            <icon className="text-4xl text-purple-200">upload_file</icon>
            <strong>{copy.filePickerDrop}</strong>
            <span className="text-xs text-white/50">{copy.filePickerBrowse}</span>
          </span>
        )}
      </button>
      <input
        accept={accept}
        className="sr-only"
        onChange={(event) => chooseFile(event.target.files?.[0])}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      {shownPreview ? (
        <button
          className="text-xs font-semibold text-rose-200 hover:underline"
          onClick={() => {
            setFileName("");
            if (localPreview) URL.revokeObjectURL(localPreview);
            setLocalPreview("");
            if (inputRef.current) inputRef.current.value = "";
            onChange?.({ error: "", file: null, value: "" });
          }}
          type="button"
        >
          {copy.filePickerRemove}
        </button>
      ) : null}
      <p className="text-xs text-white/45">
        {copy.filePickerImageRequirements.replace(
          "{size}",
          String(Math.round(maximumBytes / 1024 / 1024)),
        )}
      </p>
    </div>
  );
}
