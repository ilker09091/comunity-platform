"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type Models } from "@/lib/api/client";
import { useSession } from "@/components/providers";

export type PlatformConfig = Models["PublicPlatformConfigDto"];
export type Feature = keyof PlatformConfig["features"];

/**
 * Public platform settings and feature flags. The API enforces every flag; the UI uses
 * them to hide controls that would fail. Until loaded, features are assumed enabled.
 */
export function usePlatformConfig() {
  return useQuery({
    queryKey: ["platform-config"],
    queryFn: ({ signal }) => api("platformConfig", { signal }),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

const STAFF = ["SUPPORT", "MODERATOR", "ADMIN", "SUPER_ADMIN"];

export function useFeatures() {
  const config = usePlatformConfig().data;
  const { user } = useSession();
  const staff = !!user && STAFF.includes(user.role);
  // Staff are exempt from read-only mode on the server, so they keep write controls.
  const readOnly = !!config?.readOnlyMode && !staff;
  const on = (feature: Feature) => config?.features[feature] ?? true;
  return { config, on, readOnly, canWrite: (feature: Feature) => on(feature) && !readOnly };
}
