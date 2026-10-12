"use client";
import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import { Loader2, Minus, Plus } from "lucide-react";
import { exportCrop, fitZoom, prepareCropImage, type CropArea } from "@/lib/image-crop";
import { Modal } from "./ui";

/** Live result: the same framing the export produces, including the blurred fill around a zoomed-out photo. */
function CropPreview({ source, area, natural, width, height, round = false }: {
  source: string; area: CropArea; natural: { width: number; height: number }; width: number; height: number; round?: boolean;
}) {
  const scale = width / area.width;
  const outside = area.x < 0 || area.y < 0 || area.x + area.width > natural.width || area.y + area.height > natural.height;
  return <span className={`crop-preview-frame ${round ? "round" : ""}`} style={{ width, height }} aria-hidden="true">
    {outside && <img src={source} alt="" className="crop-preview-fill" />}
    <img src={source} alt="" className="crop-preview-photo" style={{ width: natural.width * scale, height: natural.height * scale, transform: `translate(${-area.x * scale}px, ${-area.y * scale}px)` }} />
  </span>;
}

export default function ImageCropDialog({ file, kind, onApply, onClose }: {
  file: File; kind: "avatar" | "cover"; onApply: (file: File) => void; onClose: () => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  /** Below 1 when the photo is wider/taller than the frame: zooming out shows it entirely. */
  const [minZoom, setMinZoom] = useState(1);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false, url: string | null = null;
    prepareCropImage(file).then((blob) => {
      if (disposed) return;
      url = URL.createObjectURL(blob); setSource(url);
    }).catch((err: Error) => { if (!disposed) setError(err.message); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  const apply = async () => {
    if (!source || !area || busy) return;
    setBusy(true); setError(null);
    try { onApply(await exportCrop(source, area, kind)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not crop this image."); setBusy(false); }
  };
  return <Modal title={kind === "avatar" ? "Position your profile photo" : "Position your cover photo"} onClose={onClose} guardClose={() => !busy} className="crop-dialog">
    <p className="crop-help">Drag to reposition. Use the zoom slider or pinch to frame your photo.{file.type === "image/gif" && " GIFs are saved as a still photo."}</p>
    <div className={`crop-stage ${kind}`} inert={busy}>
      {source ? <Cropper image={source} crop={crop} zoom={zoom} minZoom={minZoom} maxZoom={3} restrictPosition={zoom >= 1} aspect={kind === "avatar" ? 1 : 3} cropShape={kind === "avatar" ? "round" : "rect"} showGrid={kind === "cover"} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} onMediaLoaded={(media) => { setNatural({ width: media.naturalWidth, height: media.naturalHeight }); setMinZoom(fitZoom(media.naturalWidth, media.naturalHeight, kind)); }} keyboardStep={10} /> : !error && <Loader2 size={28} className="spin" aria-label="Preparing image" />}
    </div>
    <label className="crop-zoom"><Minus size={16} /><span className="sr-only">Zoom</span><input type="range" min={minZoom} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} disabled={!source || busy} /><Plus size={16} /><output>{Math.round(zoom * 100)}%</output></label>
    {source && <div className="crop-tools">
      {minZoom < 1 && <div className="crop-fit"><button type="button" className="chip-button" disabled={busy} onClick={() => { setZoom(minZoom); setCrop({ x: 0, y: 0 }); }}>Fit whole photo</button><button type="button" className="chip-button" disabled={busy} onClick={() => { setZoom(1); setCrop({ x: 0, y: 0 }); }}>Fill frame</button></div>}
      {area && natural && <div className="crop-preview" aria-label="Result preview">
        <span className="crop-preview-label">Preview</span>
        {kind === "avatar"
          ? <><CropPreview source={source} area={area} natural={natural} width={56} height={56} round /><CropPreview source={source} area={area} natural={natural} width={32} height={32} round /></>
          : <CropPreview source={source} area={area} natural={natural} width={168} height={56} />}
      </div>}
    </div>}
    <p className="crop-help">{kind === "avatar" ? "Your photo appears in a circular frame. Zoom out to fit a wide photo entirely." : "This 3:1 frame matches your profile cover on desktop and mobile. Zoom out to fit the whole photo."}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button" disabled={!area || busy || !source} onClick={() => void apply()}>{busy && <Loader2 size={15} className="spin" />}Apply crop</button></div>
  </Modal>;
}
