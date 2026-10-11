"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowLeft,
  Eye,
  EyeOff,
  Loader2,
  Users,
  MessageCircle,
  Sparkles,
} from "lucide-react";
import { useFeatures } from "@/lib/platform-config";
import { api, ApiError } from "@/lib/api/client";
import { broadcastSession, changeSession } from "./providers";
import { Brand } from "./main-layout";

export default function AuthForm({ register = false }: { register?: boolean }) {
  const router = useRouter();
  const client = useQueryClient();
  const [visible, setVisible] = useState(false);
  const { on } = useFeatures();
  const closed = register && !on("registration");
  const [form, setForm] = useState({
    identifier: "",
    email: "",
    username: "",
    password: "",
    displayName: "",
  });
  const mutation = useMutation({
    mutationFn: () =>
      register
        ? api("authRegister", {
            body: {
              email: form.email,
              username: form.username,
              password: form.password,
              ...(form.displayName.trim()
                ? { displayName: form.displayName.trim() }
                : {}),
            },
          })
        : api("authLogin", {
            body: { identifier: form.identifier, password: form.password },
          }),
    onSuccess: async (result) => {
      await changeSession(client, result.user);
      broadcastSession();
      router.replace("/");
    },
  });
  const details =
    mutation.error instanceof ApiError ? mutation.error.details : [];
  const field = (
    name: keyof typeof form,
    label: string,
    placeholder: string,
    type = "text",
    optional = false,
  ) => (
    <label className="form-field" key={name}>
      <span>
        {label}
        {optional && <small>Optional</small>}
      </span>
      <input
        name={name}
        type={type}
        value={form[name]}
        onChange={(e) =>
          setForm((prev) => ({ ...prev, [name]: e.target.value }))
        }
        placeholder={placeholder}
        required={!optional}
        autoComplete={
          name === "identifier" || name === "username"
            ? "username"
            : name === "email"
              ? "email"
              : "name"
        }
        maxLength={name === "username" ? 30 : name === "displayName" ? 50 : 254}
        pattern={name === "username" ? "[A-Za-z0-9_]{3,30}" : undefined}
        aria-invalid={details.some((d) => d.field === name)}
      />
      {details
        .filter((d) => d.field === name)
        .map((d) => (
          <span className="field-error" key={d.message}>
            {d.message}
          </span>
        ))}
    </label>
  );
  return (
    <div className="auth-page">
      <div className="auth-brand"><Brand /></div>
      <div className="auth-grid">
        <div className="auth-intro">
          <span className="eyebrow">LIFE IS BETTER IN GOOD COMPANY</span>
          <h1>
            Find your people.
            <br />
            Share your world.
          </h1>
          <p>
            For the big ideas, the little moments, and everything that brings us
            together.
          </p>
          <div className="auth-features">
            <span>
              <Users size={22} />
              Meaningful connections
            </span>
            <span>
              <MessageCircle size={22} />
              Conversations that matter
            </span>
            <span>
              <Sparkles size={22} />A fresh perspective, every day
            </span>
          </div>
          <div className="auth-art" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <section className="card auth-card">
          <h2>
            {register ? "Your circle starts here." : "Good to see you again."}
          </h2>
          <p className="muted">
            {register
              ? "Create your account and make yourself at home."
              : "Sign in to pick up where you left off."}
          </p>
          {closed ? (
            <p className="form-error" role="status">
              New registrations are closed right now. Please check back later.
            </p>
          ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {register ? (
              <>
                {field(
                  "displayName",
                  "Your name",
                  "How should we call you?",
                  "text",
                  true,
                )}
                {field("username", "Username", "your_username")}
                {field("email", "Email address", "you@example.com", "email")}
              </>
            ) : (
              field("identifier", "Email or username", "you@example.com")
            )}
            <label className="form-field">
              <span>Password</span>
              <div className="password-field">
                <input
                  name="password"
                  type={visible ? "text" : "password"}
                  value={form.password}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, password: e.target.value }))
                  }
                  required
                  minLength={register ? 8 : 1}
                  maxLength={128}
                  pattern={
                    register ? "(?=.*[A-Za-z])(?=.*[0-9]).{8,128}" : undefined
                  }
                  autoComplete={register ? "new-password" : "current-password"}
                  placeholder={
                    register
                      ? "Create a strong password"
                      : "Enter your password"
                  }
                  aria-invalid={details.some((d) => d.field === "password")}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {register && (
                <small>
                  8–128 characters, including a letter and a number.
                </small>
              )}
              {details
                .filter((d) => d.field === "password")
                .map((d) => (
                  <span className="field-error" key={d.message}>
                    {d.message}
                  </span>
                ))}
            </label>
            {mutation.isError && (
              <p role="alert" className="form-error">
                {mutation.error.message}
              </p>
            )}
            <button
              className="button full auth-submit"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <Loader2 className="spin" size={18} />
              ) : null}
              {mutation.isPending
                ? "One moment…"
                : register
                  ? "Create your account"
                  : "Sign in"}
              <ArrowRight size={18} />
            </button>
          </form>
          )}
          {(register || on("registration")) && (
            <p className="auth-switch">
              {register ? "Already part of the community?" : "New around here?"}{" "}
              <Link href={register ? "/login" : "/register"}>
                {register ? "Sign in" : "Join Circle"}
              </Link>
            </p>
          )}
          <Link className="back-link" href="/">
            <ArrowLeft size={14} />
            Explore the public feed
          </Link>
        </section>
      </div>
      <footer className="auth-footer">
        A little more connection. A little more Circle.
      </footer>
    </div>
  );
}
