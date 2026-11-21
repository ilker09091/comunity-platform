"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  AtSign,
  Bookmark,
  Check,
  Compass,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  Repeat2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useFeatures } from "@/lib/platform-config";
import { api, ApiError } from "@/lib/api/client";
import { broadcastSession, changeSession } from "./providers";
import { Brand } from "./main-layout";

type FormState = { identifier: string; email: string; username: string; password: string; displayName: string };
type FieldName = keyof FormState;

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/;
const PASSWORD_RULES = [
  { label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { label: "A letter", test: (value: string) => /[A-Za-z]/.test(value) },
  { label: "A number", test: (value: string) => /[0-9]/.test(value) },
];
const TITLES = { login: "Sign in | Circle", register: "Join Circle | Circle" };

/** Plain-language explanation of what went wrong and what to do next. */
function friendlyError(error: Error, register: boolean) {
  if (!(error instanceof ApiError)) return "We couldn't reach Circle. Check your internet connection and try again.";
  if (error.status === 429) return `Too many attempts. Please wait ${error.retryAfter ? `${error.retryAfter} seconds` : "a moment"} and try again.`;
  if (error.code === "INVALID_CREDENTIALS" || (!register && error.status === 401)) return "The email/username or password is incorrect. Please check them and try again.";
  if (error.code === "ACCOUNT_SUSPENDED") return "This account is not active right now.";
  if (error.code === "ACCOUNT_CONFLICT" || error.status === 409) return "That email or username is already taken. Try a different one, or sign in instead.";
  if (error.status >= 500 || error.status === 404) return "Something went wrong on our side. Please try again in a moment.";
  return error.message;
}

/** Animates its own height whenever the content changes size (mode switch, messages appearing). */
function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="auth-autoheight" style={height === null ? undefined : { height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/** One clearly labelled input with a leading icon, an optional trailing control and its messages. */
function AuthField({ id, label, icon, optional, hint, warning, errors, trailing, children }: {
  id: string; label: string; icon: ReactNode; optional?: boolean; hint?: string; warning?: string | null;
  errors: string[]; trailing?: ReactNode; children: ReactNode;
}) {
  const message = errors[0] ?? warning ?? hint;
  return (
    <div className={`auth-field ${errors.length ? "has-error" : warning ? "has-warning" : ""}`}>
      <label htmlFor={id}>
        {label}
        {optional && <small>Optional</small>}
      </label>
      <div className="auth-input">
        <span className="auth-input-icon" aria-hidden="true">{icon}</span>
        {children}
        {trailing}
      </div>
      {message && (
        <p className={`auth-field-message ${errors.length ? "error" : warning ? "warning" : ""}`} id={`${id}-hint`} key={message}>
          {errors.length > 0 && <AlertCircle size={14} aria-hidden="true" />}
          {message}
        </p>
      )}
    </div>
  );
}

/** Product preview on the brand panel: what using Circle looks like. Decorative only. */
/** A phone cycling through the feed, a chat and the baby world. */
function PhoneMock() {
  const people = [
    { name: "Your story", tone: "#fde2e4", initial: "+" },
    { name: "deniz", tone: "#d0ebff", initial: "D" },
    { name: "mert", tone: "#d3f9d8", initial: "M" },
    { name: "ece", tone: "#fff3bf", initial: "E" },
    { name: "selin", tone: "#e5dbff", initial: "S" },
  ];
  return (
    <div className="auth2-phone-wrap">
      <div className="auth2-phone">
        <span className="auth2-notch" />
        <div className="auth2-screens">
          {/* Feed */}
          <div className="auth2-screen s1">
            <div className="auth2-bar"><b>Circle</b><span><Heart size={15} /><MessageCircle size={15} /></span></div>
            <div className="auth2-stories">
              {people.map((p, i) => (
                <span key={p.name} className={i > 0 && i < 4 ? "auth2-ring" : ""}>
                  <i style={{ background: p.tone }}>{p.initial}</i>
                  <small>{p.name}</small>
                </span>
              ))}
            </div>
            <div className="auth2-post">
              <div className="auth2-post-head"><i style={{ background: "#d0ebff" }}>D</i><b>deniz</b><small>· 2m</small></div>
              <img src="/chatthemes/sunset.webp" alt="" />
              <div className="auth2-post-actions"><Heart size={15} fill="#ff3040" color="#ff3040" /><MessageCircle size={15} /><Repeat2 size={15} /><Bookmark size={15} /></div>
              <p><b>128 likes</b></p>
              <p><b>deniz</b> Sunset walk by the sea tonight 🌅</p>
            </div>
          </div>
          {/* Chat */}
          <div className="auth2-screen s2">
            <div className="auth2-bar chat"><i style={{ background: "#fff3bf" }}>E</i><span><b>ece</b><small>Active now</small></span></div>
            <div className="auth2-chat">
              <p className="in">Günaydın ☀️</p>
              <p className="out">Günaydın! Kahve? ☕</p>
              <p className="in">Akşam film izleyelim mi? 🎬</p>
              <p className="out">Olur, ben seçiyorum 😄</p>
              <p className="in">Tamam tamam 🙈</p>
              <p className="out love">❤️</p>
            </div>
            <div className="auth2-compose">Message…</div>
          </div>
          {/* Our baby */}
          <div className="auth2-screen s3">
            <img className="auth2-world" src="/baby/world/scene/garden/bg-day.webp" alt="" />
            <img className="auth2-kid" src="/baby/girl-2-1.webp" alt="" />
            <img className="auth2-pup" src="/baby/world/garden/puppy-idle.webp" alt="" />
            <span className="auth2-world-tag"><b>Ada</b> · Toddler 💗</span>
            <span className="auth2-world-hearts"><i>💗</i><i>💕</i><i>💗</i></span>
          </div>
        </div>
      </div>
      <span className="auth2-float f1"><UserPlus size={14} /> <b>Ece</b> started following you</span>
      <span className="auth2-float f2"><Heart size={14} fill="#ff3040" color="#ff3040" /> <b>Mert</b> liked your photo</span>
    </div>
  );
}

function Showcase() {
  return (
    <aside className="auth-showcase" aria-hidden="true">
      <div className="auth-aurora"><i /><i /><i /></div>
      <div className="auth-showcase-brand"><Brand /><span>Circle</span></div>

      <div className="auth-showcase-copy">
        <span className="auth-kicker"><span />A little more connection</span>
        <h2>Find your people.<br /><em>Share your world.</em></h2>
        <p>Post photos and videos, follow the people you care about and join conversations, all in one calm, friendly place.</p>
      </div>

      <div className="auth-stage auth-stage-phone">
        <PhoneMock />
      </div>

      <ul className="auth-showcase-points">
        <li><Check size={14} strokeWidth={3} />Photos, videos &amp; reels</li>
        <li><Check size={14} strokeWidth={3} />Follow friends</li>
        <li><Check size={14} strokeWidth={3} />Free to join</li>
      </ul>
    </aside>
  );
}

export default function AuthForm({ register: initialRegister = false }: { register?: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  // Switching tabs stays on this page (no reload) so the form can morph smoothly; the URL follows along.
  const [register, setRegister] = useState(initialRegister);
  const [visible, setVisible] = useState(false);
  const { on } = useFeatures();
  const registrationOpen = on("registration");
  const closed = register && !registrationOpen;
  const [form, setForm] = useState<FormState>({ identifier: "", email: "", username: "", password: "", displayName: "" });
  const mutation = useMutation({
    mutationFn: () =>
      register
        ? api("authRegister", {
            body: {
              email: form.email,
              username: form.username,
              password: form.password,
              ...(form.displayName.trim() ? { displayName: form.displayName.trim() } : {}),
            },
          })
        : api("authLogin", { body: { identifier: form.identifier, password: form.password } }),
    onSuccess: async (result) => {
      await changeSession(client, result.user);
      broadcastSession();
      router.replace("/");
    },
  });
  const switchMode = (next: boolean) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // keep "open in new tab" working
    e.preventDefault();
    if (next === register) return;
    mutation.reset();
    setRegister(next);
    window.history.replaceState(null, "", next ? "/register" : "/login");
    document.title = next ? TITLES.register : TITLES.login;
  };
  const details = mutation.error instanceof ApiError ? mutation.error.details : [];
  const errorsFor = (name: FieldName) => details.filter((d) => d.field === name).map((d) => d.message);
  const fieldErrorShown = details.some((d) => d.field && d.field in form);
  const input = (name: FieldName) => ({
    id: `auth-${name}`,
    name,
    value: form[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((prev) => ({ ...prev, [name]: e.target.value })),
    "aria-invalid": errorsFor(name).length > 0,
    "aria-describedby": `auth-${name}-hint`,
  });
  const usernameWarning = register && form.username && !USERNAME_RE.test(form.username)
    ? form.username.length < 3 ? "Too short: use at least 3 characters." : "Only letters, numbers and underscores (_), no spaces."
    : null;
  const passed = PASSWORD_RULES.map((rule) => rule.test(form.password));
  const passwordToggle = (
    <button type="button" className="auth-input-action" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible(!visible)}>
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      <span>{visible ? "Hide" : "Show"}</span>
    </button>
  );
  const mode = register ? "register" : "login";

  return (
    <div className="auth-shell">
      <Showcase />

      <main className="auth-main">
        <div className="auth-main-top">
          <span className="auth-mobile-brand"><Brand /></span>
          <Link href="/" className="auth-explore"><Compass size={16} />Explore first</Link>
        </div>

        <section className="auth-panel" aria-labelledby="auth-title">
          {(registrationOpen || register) && (
            <nav className="auth-tabs" aria-label="Account">
              <a href="/login" onClick={switchMode(false)} className={!register ? "active" : ""} aria-current={!register ? "page" : undefined}>Sign in</a>
              <a href="/register" onClick={switchMode(true)} className={register ? "active" : ""} aria-current={register ? "page" : undefined}>Create account</a>
              <span className={`auth-tabs-indicator ${register ? "right" : ""}`} aria-hidden="true" />
            </nav>
          )}

          <AutoHeight>
            <div className="auth-swap" key={mode}>
              <header className="auth-heading">
                <h1 id="auth-title">{register ? "Create your account" : "Welcome back"}</h1>
                <p>{register ? "It's free and takes less than a minute." : "Sign in with your email or username."}</p>
              </header>

              {closed ? (
                <div className="auth-alert" role="status">
                  <AlertCircle size={18} aria-hidden="true" />
                  <div><strong>Sign-ups are paused</strong><p>New registrations are closed right now. Please check back later.</p></div>
                </div>
              ) : (
                <form
                  className="auth-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    mutation.mutate();
                  }}
                >
                  {register ? (
                    <>
                      <AuthField id="auth-displayName" label="Your name" icon={<UserRound size={18} />} optional hint="This is how people will see you." errors={errorsFor("displayName")}>
                        <input {...input("displayName")} type="text" placeholder="e.g. Alex Morgan" autoComplete="name" maxLength={50} />
                      </AuthField>
                      <AuthField id="auth-username" label="Username" icon={<AtSign size={18} />} hint="Letters, numbers and _ only. No spaces." warning={usernameWarning} errors={errorsFor("username")}>
                        <input {...input("username")} type="text" placeholder="your_name" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" />
                      </AuthField>
                      <AuthField id="auth-email" label="Email" icon={<Mail size={18} />} hint="We never show your email to anyone." errors={errorsFor("email")}>
                        <input {...input("email")} type="email" placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" required maxLength={254} />
                      </AuthField>
                    </>
                  ) : (
                    <AuthField id="auth-identifier" label="Email or username" icon={<UserRound size={18} />} errors={errorsFor("identifier")}>
                      <input {...input("identifier")} type="text" placeholder="you@example.com or your_name" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} />
                    </AuthField>
                  )}

                  <AuthField id="auth-password" label="Password" icon={<Lock size={18} />} errors={errorsFor("password")} trailing={passwordToggle}>
                    <input
                      {...input("password")}
                      type={visible ? "text" : "password"}
                      placeholder={register ? "Create a password" : "Your password"}
                      autoComplete={register ? "new-password" : "current-password"}
                      required
                      minLength={register ? 8 : 1}
                      maxLength={128}
                      pattern={register ? "(?=.*[A-Za-z])(?=.*[0-9]).{8,128}" : undefined}
                    />
                  </AuthField>
                  {register && (
                    <ul className="auth-rules" aria-label="Password requirements">
                      {PASSWORD_RULES.map((rule, i) => (
                        <li key={rule.label} className={passed[i] ? "ok" : ""}>
                          <span aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                          {rule.label}
                          <span className="sr-only">{passed[i] ? " (done)" : " (missing)"}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {mutation.isError && !fieldErrorShown && (
                    <div className="auth-alert error" role="alert">
                      <AlertCircle size={18} aria-hidden="true" />
                      <div><strong>{register ? "We couldn't create your account" : "We couldn't sign you in"}</strong><p>{friendlyError(mutation.error, register)}</p></div>
                    </div>
                  )}

                  <button className={`button full auth-submit ${mutation.isPending ? "is-loading" : ""}`} disabled={mutation.isPending}>
                    {mutation.isPending ? <Loader2 className="spin" size={18} /> : null}
                    {mutation.isPending ? (register ? "Creating your account…" : "Signing in…") : register ? "Create account" : "Sign in"}
                    {!mutation.isPending && <ArrowRight size={18} />}
                  </button>
                </form>
              )}

              {(register || registrationOpen) && (
                <p className="auth-switch">
                  {register ? "Already have an account?" : "Don't have an account?"}{" "}
                  <a href={register ? "/login" : "/register"} onClick={switchMode(!register)}>{register ? "Sign in" : "Create one, it's free"}</a>
                </p>
              )}
            </div>
          </AutoHeight>

          <div className="auth-divider"><span>or</span></div>
          <Link href="/" className="button secondary full auth-guest">
            <Compass size={17} />Look around without an account
          </Link>
        </section>

        <footer className="auth-footer">© Circle · A little more connection.</footer>
      </main>
    </div>
  );
}
