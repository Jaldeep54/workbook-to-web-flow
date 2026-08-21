import { useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { fileUrl } from "@/services/api-client";
import { SHOP_IMAGE_ACCEPT, isAcceptedImage, isHeicFile, isHeicPath } from "@/lib/shop-image";

/**
 * Shop photo picker: validates the file type, previews it, and supports
 * replace/remove. The existing photo arrives as a signed URL on the shop
 * record, so there's nothing to fetch here.
 */
export function ShopImageField({
  existingPath,
  existingUrl,
  file,
  removed,
  onFileChange,
  onRemove,
}: {
  existingPath: string | null;
  existingUrl?: string | null;
  file: File | null;
  removed: boolean;
  onFileChange: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const objectUrl = useMemo(
    () => (file && !isHeicFile(file) ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );

  const showExisting = !file && !removed && !!existingPath;
  const existingSrc = showExisting && existingUrl ? fileUrl(existingUrl) : null;

  const handlePick = (list: FileList | null) => {
    const picked = list?.[0];
    if (!picked) return;
    if (!isAcceptedImage(picked)) {
      setError("Use a JPG, PNG, HEIC or HEIF file.");
      return;
    }
    setError(null);
    onFileChange(picked);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Shop image</Label>
      <div className="flex items-center gap-3">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/40">
          {file && objectUrl && (
            <img src={objectUrl} alt="Shop preview" className="size-full object-cover" />
          )}
          {file && !objectUrl && (
            <span className="px-1 text-center text-[10px] text-muted-foreground">
              HEIC selected
            </span>
          )}
          {existingSrc && !isHeicPath(existingPath ?? "") && (
            <img src={existingSrc} alt="Shop" className="size-full object-cover" />
          )}
          {existingSrc && isHeicPath(existingPath ?? "") && (
            <a
              href={existingSrc}
              target="_blank"
              rel="noreferrer"
              className="px-1 text-center text-[10px] text-primary underline"
            >
              View HEIC original
            </a>
          )}
          {!file && !existingSrc && <ImageIcon className="size-6 text-muted-foreground/50" />}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-3.5" /> {existingPath || file ? "Replace" : "Upload"}
            </Button>
            {(file || (existingPath && !removed)) && (
              <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
                <X className="size-3.5" /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG, HEIC or HEIF</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={SHOP_IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            handlePick(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
