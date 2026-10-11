"use client";
import { useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import { Loader2, Minus, Plus } from "lucide-react";
import { exportCrop, prepareCropImage, type CropArea } from "@/lib/image-crop";
import { Modal } from "./ui";

export default function ImageCropDialog({ file, kind, onApply, onClose }: {
  file: File; kind: "avatar" | "cover"; onApply: (file: File) => void; onClose: () => void;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
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
      {source ? <Cropper image={source} crop={crop} zoom={zoom} aspect={kind === "avatar" ? 1 : 3} cropShape={kind === "avatar" ? "round" : "rect"} showGrid={kind === "cover"} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} keyboardStep={10} maxZoom={3} /> : !error && <Loader2 size={28} className="spin" aria-label="Preparing image" />}
    </div>
    <label className="crop-zoom"><Minus size={16} /><span className="sr-only">Zoom</span><input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} disabled={!source || busy} /><Plus size={16} /><output>{Math.round(zoom * 100)}%</output></label>
    <p className="crop-help">{kind === "avatar" ? "Your square photo will appear in a circular frame." : "This 3:1 frame matches your profile cover on desktop and mobile."}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="button" disabled={!area || busy || !source} onClick={() => void apply()}>{busy && <Loader2 size={15} className="spin" />}Apply crop</button></div>
  </Modal>;
}
