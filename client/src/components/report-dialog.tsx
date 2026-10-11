"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api, ApiError, type Models } from "@/lib/api/client";
import { Modal } from "./ui";

type Reason = Models["CreateReportDto"]["reason"];
const REASONS: { value: Reason; label: string; hint: string }[] = [
  { value: "SPAM", label: "Spam", hint: "Misleading, repetitive or unwanted content" },
  { value: "HARASSMENT", label: "Harassment or bullying", hint: "Targeting or intimidating someone" },
  { value: "HATE_SPEECH", label: "Hate speech", hint: "Attacks based on identity" },
  { value: "VIOLENCE", label: "Violence or threats", hint: "Threatening or promoting harm" },
  { value: "NUDITY", label: "Nudity or sexual content", hint: "" },
  { value: "SELF_HARM", label: "Self-harm", hint: "Content that encourages self-harm" },
  { value: "MISINFORMATION", label: "False information", hint: "" },
  { value: "IMPERSONATION", label: "Impersonation", hint: "Pretending to be someone else" },
  { value: "INTELLECTUAL_PROPERTY", label: "Intellectual property", hint: "Copyright or trademark violation" },
  { value: "OTHER", label: "Something else", hint: "" },
];

/** Reports a user, post or comment through the moderation queue (POST /reports). */
export default function ReportDialog({
  targetType,
  targetId,
  subject,
  onClose,
}: {
  targetType: Models["CreateReportDto"]["targetType"];
  targetId: string;
  /** e.g. "@jane_doe" or "this post" */
  subject: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState("");
  const cache = useQueryClient();
  const mutation = useMutation({
    onSuccess: () => { if (targetType === 'POST') void cache.invalidateQueries({queryKey:['posts','reels']}); },
    mutationFn: () =>
      api("reportsCreate", {
        body: { targetType, targetId, reason: reason!, ...(details.trim() ? { details: details.trim() } : {}) },
      }),
  });
  const already = mutation.error instanceof ApiError && mutation.error.code === "ALREADY_REPORTED";
  return (
    <Modal title={`Report ${subject}`} onClose={onClose} className="report-dialog">
      {mutation.isSuccess || already ? (
        <div className="report-done">
          <CheckCircle2 size={34} />
          <h3>{already ? "You’ve already reported this" : "Thanks for letting us know"}</h3>
          <p>
            {already
              ? "Your earlier report is still being reviewed by our moderators."
              : "Our moderators will review your report. The account isn’t told who reported it."}
          </p>
          <button className="button" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason && !mutation.isPending) mutation.mutate();
          }}
        >
          <p className="muted report-intro">Why are you reporting {subject}?</p>
          <div className="report-reasons" role="radiogroup" aria-label="Report reason">
            {REASONS.map((r) => (
              <label key={r.value} className={`report-reason ${reason === r.value ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                />
                <span>
                  <strong>{r.label}</strong>
                  {r.hint && <small>{r.hint}</small>}
                </span>
              </label>
            ))}
          </div>
          <label className="form-field">
            <span>
              Additional details <small>Optional</small>
            </span>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} />
          </label>
          {mutation.isError && !already && (
            <p className="form-error" role="alert">
              {mutation.error.message}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="button" disabled={!reason || mutation.isPending}>
              {mutation.isPending && <Loader2 size={15} className="spin" />}
              Submit report
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
