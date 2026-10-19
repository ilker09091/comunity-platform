"use client";
import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError, type Models } from "@/lib/api/client";
import VideoPlaybackBoundary from "./video-playback-boundary";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
import { changeSession } from "@/lib/session-cache";
import AppBridge from "./app-bridge";
import CallsProvider from "./calls";
import { haptic } from "@/lib/haptics";
export { changeSession } from "@/lib/session-cache";

const ToastContext = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export const useToast = () => useContext(ToastContext);
const SessionContext = createContext<{
  user: Models["MeDto"] | null;
  loading: boolean;
  error: Error | null;
  logout: () => Promise<void>;
}>({ user: null, loading: true, error: null, logout: async () => {} });
export const useSession = () => useContext(SessionContext);
function Session({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const toast = useToast();
  const me = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => api("usersGetMe", { signal }),
    retry: false,
    staleTime: 60000,
  });
  useEffect(() => {
    const expire = () => {
      const signedIn = !!client.getQueryData(["session"]);
      client.setQueryData(["session"], null);
      if (signedIn) {
        void client.resetQueries({
          predicate: (q) => q.queryKey[0] !== "session",
        });
        toast("Your session has expired. Please sign in again.", true);
      }
    };
    const sync = () => {
      void client.resetQueries();
    };
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("social-session")
        : null;
    if (channel) channel.onmessage = sync;
    window.addEventListener("session-expired", expire);
    return () => {
      window.removeEventListener("session-expired", expire);
      channel?.close();
    };
  }, [client, toast]);
  const logout = async () => {
    try {
      await api("authLogout");
      await changeSession(client, null);
      broadcastSession();
      toast("You have signed out.");
    } catch (error) {
      toast(
        error instanceof Error ? error.message : "Unable to sign out.",
        true,
      );
    }
  };
  return (
    <SessionContext.Provider
      value={{
        user: me.data ?? null,
        loading: me.isPending,
        error:
          me.error instanceof ApiError && me.error.status === 401
            ? null
            : me.error,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function broadcastSession() {
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("social-session");
    channel.postMessage("changed");
    channel.close();
  }
}
export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30000,
            refetchOnWindowFocus: true,
            retry: (count, error) =>
              count < 2 &&
              (!(error instanceof ApiError) ||
                error.status >= 500 ||
                error.status === 0),
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
          },
          mutations: { retry: false },
        },
      }),
  );
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const showToast = useCallback(
    (text: string, error = false) => { haptic(error ? "error" : "success"); setToast({ text, error }); },
    [],
  );
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return (
    <QueryClientProvider client={client}>
      <ToastContext.Provider value={showToast}>
        <Session><CallsProvider><VideoPlaybackBoundary /><AppBridge />{children}</CallsProvider></Session>
        {toast && (
          <div
            className={`toast ${toast.error ? "toast-error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.error ? (
              <AlertCircle size={20} />
            ) : (
              <CheckCircle2 size={20} />
            )}
            <span>{toast.text}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setToast(null)}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </ToastContext.Provider>
    </QueryClientProvider>
  );
}
