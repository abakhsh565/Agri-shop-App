import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * The picture the person just chose, framed before it is saved.
 *
 * WHY THIS STEP EXISTS. Choosing a file used to save it as it came off the camera: the tile is a
 * fixed square drawn with `object-cover`, so whatever shape the photo was, the screen silently cut
 * it. An owner photographing a licence on a table had no way to say which part of the frame was the
 * paper. Here they do — the frame is the shape the slot will draw, the picture moves under it, and
 * what is saved is exactly what the frame holds.
 *
 * THE FRAME'S SHAPE IS THE SLOT'S. A square slot (the business picture, `aspect` 1) gets a square
 * frame. A paper gets no `aspect` at all, which means the frame takes the photo's own shape: a
 * licence or a CNIC keeps its full width instead of being squared off, and the owner still trims
 * the table around it. Forcing a square onto a document would cut the words off it.
 *
 * IT IS DRAWN ON A CANVAS, not sent to a service: the trimmed pixels are reproduced at the size the
 * frame really covers, so a high-resolution photo stays high-resolution. Nothing here is a fallback
 * for a missing page — if the browser cannot decode the picture at all, the screen says so and
 * offers a way back rather than saving something broken.
 *
 * DEVICE PICTURES ARE OFTEN HUGE. The longest edge of what is saved is capped, because the same
 * picture is uploaded to a bucket and drawn in an 84px tile; the cap is well above tile resolution
 * so the paper is still readable when opened.
 */
const MAX_OUTPUT_EDGE = 1600;
const JPEG_QUALITY = 0.9;
/** Breathing room between the frame and the edge of the stage. */
const STAGE_PAD = 24;
/** How far the picture may be enlarged past the smallest size that fills the frame. */
const MAX_ZOOM = 5;

type Size = { w: number; h: number };

export interface ImageCropProps {
  /** The picture as it was chosen. */
  file: File;
  /**
   * The frame's shape (width ÷ height) — 1 for a square slot. Left out, the frame takes the
   * picture's own shape, which trims without cropping the whole way across.
   */
  aspect?: number;
  onCancel: () => void;
  /** Called with the trimmed picture once the frame holds what the person wants. */
  onConfirm: (picture: File) => void;
}

export default function ImageCrop({ file, aspect, onCancel, onConfirm }: ImageCropProps) {
  const t = useT();

  // The chosen file is read from this device only, and its object URL is released with the screen.
  // It is created INSIDE the effect rather than during render: a render-time URL belongs to the
  // render that made it, so the first mount's cleanup would revoke it and the second mount — which
  // is what React's development-mode double mount always does — would then draw a revoked URL, be
  // refused by the browser, and report the picture as unreadable.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const stageRef = useRef<HTMLDivElement>(null);
  const pictureRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchFrom = useRef<{ distance: number; zoom: number } | null>(null);

  const [stage, setStage] = useState<Size | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [broken, setBroken] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // The stage is measured rather than assumed: the frame is placed from its real size, so the
  // same screen works on a phone, a tablet and a desktop window without a breakpoint.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setStage((current) =>
        current && Math.abs(current.w - rect.width) < 0.5 && Math.abs(current.h - rect.height) < 0.5
          ? current
          : { w: rect.width, h: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** The frame: the slot's shape, or the picture's own, drawn as large as the stage allows. */
  const frame = useMemo<Size | null>(() => {
    if (!stage || !natural) return null;
    const shape = aspect ?? natural.w / natural.h;
    const widest = Math.max(48, stage.w - STAGE_PAD * 2);
    const tallest = Math.max(48, stage.h - STAGE_PAD * 2);
    const w = Math.min(widest, tallest * shape);
    return { w, h: w / shape };
  }, [stage, natural, aspect]);

  /** The picture at the smallest size that still covers the frame — the start of the zoom range. */
  const filling = useMemo<Size | null>(() => {
    if (!natural || !frame) return null;
    const ratio = Math.max(frame.w / natural.w, frame.h / natural.h);
    return { w: natural.w * ratio, h: natural.h * ratio };
  }, [natural, frame]);

  /** What is actually drawn, in stage pixels. */
  const shown = useMemo<Size | null>(
    () => (filling ? { w: filling.w * zoom, h: filling.h * zoom } : null),
    [filling, zoom],
  );

  /** The picture may not be dragged off the frame: every edge of the frame stays covered. */
  const clampOffset = useCallback(
    (next: { x: number; y: number }, size: Size | null, box: Size | null) => {
      if (!size || !box) return next;
      const maxX = Math.max(0, (size.w - box.w) / 2);
      const maxY = Math.max(0, (size.h - box.h) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y)),
      };
    },
    [],
  );

  // Zooming out is only allowed as far as the frame stays covered, so the offset is re-clamped
  // whenever the drawn size changes — otherwise a zoom-out would leave a bare strip on screen.
  useEffect(() => {
    setOffset((current) => clampOffset(current, shown, frame));
  }, [shown, frame, clampOffset]);

  const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(1, value));

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Capture keeps a real finger's drag alive past the edge of the stage. It is not what makes
    // dragging work, so a pointer the browser will not hand over (a synthetic one, an odd device)
    // must not stop the drag from starting.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works inside the stage */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchFrom.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers zoom, one finger moves — the gesture a phone already taught everyone.
    if (pointers.current.size >= 2 && pinchFrom.current) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchFrom.current.distance > 0) {
        setZoom(clampZoom((pinchFrom.current.zoom * distance) / pinchFrom.current.distance));
      }
      return;
    }

    setOffset((current) =>
      clampOffset(
        { x: current.x + (e.clientX - before.x), y: current.y + (e.clientY - before.y) },
        shown,
        frame,
      ),
    );
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    setZoom((current) => clampZoom(current * (e.deltaY > 0 ? 0.94 : 1.06)));
  }

  const ready = Boolean(stage && natural && frame && shown);

  /**
   * Copy the part of the picture the frame holds onto a canvas, at the picture's own resolution.
   *
   * The mapping is one affine step: the frame's rectangle in stage pixels is translated back into
   * the picture's pixels through the same offset and scale the screen is drawing with. Nothing is
   * guessed, because the drawn rectangle is computed from the same four numbers that were used to
   * place it.
   */
  async function saveFramedPicture() {
    const picture = pictureRef.current;
    if (!picture || !stage || !natural || !frame || !shown || saving) return;
    setSaving(true);
    try {
      const drawnLeft = (stage.w - shown.w) / 2 + offset.x;
      const drawnTop = (stage.h - shown.h) / 2 + offset.y;
      const frameLeft = (stage.w - frame.w) / 2;
      const frameTop = (stage.h - frame.h) / 2;

      const sourceX = ((frameLeft - drawnLeft) / shown.w) * natural.w;
      const sourceY = ((frameTop - drawnTop) / shown.h) * natural.h;
      const sourceW = (frame.w / shown.w) * natural.w;
      const sourceH = (frame.h / shown.h) * natural.h;

      const output = Math.min(1, MAX_OUTPUT_EDGE / Math.max(sourceW, sourceH));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceW * output));
      canvas.height = Math.max(1, Math.round(sourceH * output));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      // A JPEG has no transparency: without a paper-coloured base, a PNG with a hole in it would
      // come out with black where its transparency was.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(picture, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) throw new Error("no picture");

      const name = file.name.replace(/\.[^.]*$/, "").trim() || "photo";
      onConfirm(new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
    } catch {
      // A browser that cannot produce the trimmed copy still gets the picture saved rather than
      // losing the owner's work to an editor that would not finish.
      onConfirm(file);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0a0a0a" }}
      role="dialog"
      aria-modal="true"
      aria-label={t("business.cropTitle")}
      data-testid="image-crop"
    >
      <div className="flex items-center justify-between px-5" style={{ paddingTop: 48 }}>
        <button
          type="button"
          onClick={onCancel}
          aria-label={t("common.cancel")}
          data-testid="image-crop-cancel"
          className="size-11 -ms-3 flex items-center justify-center ds-pressable"
          style={{ color: "#fff" }}
        >
          <X size={22} />
        </button>
        <p className="text-14 font-semibold" style={{ color: "#fff" }}>
          {t("business.cropTitle")}
        </p>
        <button
          type="button"
          onClick={() => void saveFramedPicture()}
          disabled={!ready || saving}
          data-testid="image-crop-confirm"
          className="h-11 min-w-11 flex items-center justify-center text-14 font-semibold ds-pressable disabled:opacity-40"
          style={{ color: "var(--brand)" }}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : t("common.save")}
        </button>
      </div>

      {broken ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8" data-testid="image-crop-unreadable">
          <p className="text-13 text-center" style={{ color: "rgba(255,255,255,0.72)" }}>
            {t("business.cropUnreadable")}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-5 rounded-full text-13 font-semibold ds-pressable"
            style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
          >
            {t("common.close")}
          </button>
        </div>
      ) : (
        <>
          <div
            ref={stageRef}
            className="relative flex-1 min-h-0 overflow-hidden"
            style={{ touchAction: "none", cursor: "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onWheel={onWheel}
          >
            {src && (
              <img
                ref={pictureRef}
                src={src}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="absolute select-none"
                style={{
                  left: "50%",
                  top: "50%",
                  width: shown?.w ?? "100%",
                  height: shown?.h ?? "auto",
                  maxWidth: "none",
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                  visibility: shown ? "visible" : "hidden",
                }}
                onLoad={(e) =>
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
                onError={() => setBroken(true)}
              />
            )}

            {frame && (
              // The frame is the answer: everything it does not hold is dimmed, so what will be
              // saved is never in question while the picture is being moved.
              <div
                className="absolute"
                style={{
                  left: "50%",
                  top: "50%",
                  width: frame.w,
                  height: frame.h,
                  transform: "translate(-50%, -50%)",
                  border: "1px solid rgba(255,255,255,0.85)",
                  boxShadow: "0 0 0 100vmax rgba(0,0,0,0.62)",
                  pointerEvents: "none",
                }}
              >
                {[1, 2].map((n) => (
                  <span
                    key={`v${n}`}
                    className="absolute inset-y-0"
                    style={{
                      insetInlineStart: `${(n * 100) / 3}%`,
                      width: 1,
                      background: "rgba(255,255,255,0.22)",
                    }}
                  />
                ))}
                {[1, 2].map((n) => (
                  <span
                    key={`h${n}`}
                    className="absolute inset-x-0"
                    style={{ top: `${(n * 100) / 3}%`, height: 1, background: "rgba(255,255,255,0.22)" }}
                  />
                ))}
              </div>
            )}

            {!ready && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin" color="#fff" />
              </span>
            )}
          </div>

          <div className="px-5 pt-3 pb-6">
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(clampZoom(Number(e.target.value)))}
              aria-label={t("business.cropZoom")}
              data-testid="image-crop-zoom"
              className="w-full"
              style={{ accentColor: "var(--brand)" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
