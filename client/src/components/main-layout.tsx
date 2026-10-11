"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  Compass,
  Bookmark,
  Users,
  UserRound,
  Settings,
  Bell,
  Search,
  ChevronDown,
  LogOut,
  Clapperboard,
  PlusSquare,
  ShieldCheck,
  CircleAlert,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useFeatures } from "@/lib/platform-config";
import { useSession } from "./providers";
import { Avatar, Dropdown, ErrorState } from "./ui";
import FollowButton from "./follow-button";
import { ActivityWidget, useUnreadTotal, WidgetSkeleton } from "./notifications";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Circle home">
      <Image className="brand-logo" src="/circle-logo.png" alt="Circle" width={706} height={728} sizes="(max-width: 767px) 34px, 40px" />
    </Link>
  );
}

function UnreadBadge({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="nav-badge">{count > 99 ? "99+" : count}</span>;
}

export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useSession();
  const unreadTotal = useUnreadTotal();
  const { on } = useFeatures();
  const [search, setSearch] = useState("");
  const staff = !!user && user.role !== "USER";
  const nav = [
    { href: "/", label: "Home", icon: Home },
    { href: "/explore", label: "Explore", icon: Compass },
    { href: "/reels", label: "Reels", icon: Clapperboard },
    { href: "/notifications", label: "Notifications", icon: Bell, badge: unreadTotal },
    { href: "/following", label: "Following", icon: Users },
  ].filter((item) => item.href !== "/reels" || on("reels"));
  return (
    <header className="app-header">
      <div className="app-container header-inner">
        <div className="header-left">
          <Brand />
          {on("search") && (
          <form
            className="header-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const q = search.trim();
              router.push(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore");
            }}
          >
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search people and posts"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={100}
            />
          </form>
          )}
        </div>
        <nav className="header-nav" aria-label="Main navigation">
          {nav.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                aria-label={badge ? `${label}, ${badge} unread` : label}
                title={label}
              >
                <Icon size={21} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
                <UnreadBadge count={badge} />
              </Link>
            );
          })}
        </nav>
        <div className="header-right">
          {on("search") && (
            <Link href="/explore" className="icon-button mobile-only" aria-label="Search">
              <Search size={20} />
            </Link>
          )}
          <Link
            href="/notifications"
            className="icon-button mobile-only header-bell"
            aria-label={unreadTotal ? `Notifications, ${unreadTotal} unread` : "Notifications"}
          >
            <Bell size={20} />
            <UnreadBadge count={unreadTotal} />
          </Link>
          {user ? (
            <Dropdown
              label="Account menu"
              className="profile-dropdown"
              summary={
                <>
                  <Avatar user={user} size={34} />
                  <span className="profile-dropdown-name">{user.displayName}</span>
                  <ChevronDown size={15} className="chevron" aria-hidden="true" />
                </>
              }
            >
              <div className="dropdown-user">
                <strong>{user.displayName}</strong>
                <span>@{user.username}</span>
              </div>
              <Link href={`/profile/${user.username}`}>
                <UserRound size={16} /> My profile
              </Link>
              <Link href="/saved">
                <Bookmark size={16} /> Saved posts
              </Link>
              <Link href="/settings">
                <Settings size={16} /> Settings
              </Link>
              {staff && (
                <Link href="/admin">
                  <ShieldCheck size={16} /> Admin control center
                </Link>
              )}
              <hr />
              <button type="button" onClick={() => void logout()}>
                <LogOut size={16} /> Sign out
              </button>
            </Dropdown>
          ) : (
            <div className="header-auth">
              <Link href="/login" className="button ghost small">
                Sign in
              </Link>
              {on("registration") && (
                <Link href="/register" className="button small">
                  Join
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function CoverArt() {
  return <div className="cover-art" aria-hidden="true" />;
}

export function ProfileCard() {
  const { user, loading, error } = useSession();
  const { on } = useFeatures();
  if (loading)
    return (
      <section className="card profile-card" aria-busy="true">
        <div className="profile-cover">
          <CoverArt />
        </div>
        <div className="profile-card-body">
          <span className="profile-card-avatar skeleton circle" />
          <div className="skeleton line short center" />
          <div className="skeleton line tiny center" />
        </div>
      </section>
    );
  if (!user)
    return (
      <section className="card profile-card guest">
        <div className="profile-cover">
          <CoverArt />
        </div>
        <div className="profile-card-body">
          <h2>Welcome to Circle</h2>
          <p className="muted">Share your world and find your people.</p>
          {error && <p className="inline-error">The server is temporarily unavailable.</p>}
          {on("registration") && (
            <Link href="/register" className="button full">
              Create account
            </Link>
          )}
          <Link href="/login" className="button ghost full">
            Sign in
          </Link>
        </div>
      </section>
    );
  return (
    <section className="card profile-card" aria-label="Your profile">
      <div className="profile-cover">
        {user.coverUrl ? <img src={user.coverUrl} alt="" /> : <CoverArt />}
      </div>
      <div className="profile-card-body">
        <Link href={`/profile/${user.username}`} className="profile-card-avatar" aria-label="Your profile">
          <Avatar user={user} size={74} />
        </Link>
        <h2><Link href={`/profile/${user.username}`}>{user.displayName}</Link></h2>
        <p className="muted"><Link href={`/profile/${user.username}`}>@{user.username}</Link></p>
        <dl className="profile-stats">
          {(
            [
              [user.postCount, "Posts"],
              [user.followerCount, "Followers"],
              [user.followingCount, "Following"],
            ] as const
          ).map(([count, label]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{Number(count).toLocaleString("en")}</dd>
            </div>
          ))}
        </dl>
        <Link href={`/profile/${user.username}`} className="button full">
          My Profile
        </Link>
      </div>
    </section>
  );
}

export function Shortcuts() {
  const pathname = usePathname();
  const { user } = useSession();
  const { on } = useFeatures();
  const items = [
    { href: "/", label: "Home", icon: Home },
    { href: "/explore", label: "Explore", icon: Compass },
    { href: "/reels", label: "Reels", icon: Clapperboard },
    { href: "/saved", label: "Saved Posts", icon: Bookmark },
    { href: "/following", label: "Following", icon: Users },
    { href: user ? `/profile/${user.username}` : "/login", label: "My Profile", icon: UserRound },
    { href: "/settings", label: "Settings", icon: Settings },
  ].filter((item) => item.href !== "/reels" || on("reels"));
  return (
    <nav className="card shortcuts" aria-labelledby="shortcuts-title">
      <div className="widget-heading">
        <h2 id="shortcuts-title">Your Shortcuts</h2>
      </div>
      <ul>
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={label}>
              <Link href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                <span className="shortcut-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LeftSidebar() {
  return (
    <aside className="left-sidebar" aria-label="Profile and shortcuts">
      <ProfileCard />
      <Shortcuts />
    </aside>
  );
}

export function SuggestedUsers() {
  const { user, loading } = useSession();
  const query = useQuery({
    queryKey: ["suggestions"],
    queryFn: ({ signal }) => api("followsSuggestions", { query: { limit: 5 }, signal }),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  if (!loading && !user) return null;
  return (
    <section className="card widget" aria-labelledby="suggested-title">
      <div className="widget-heading">
        <h2 id="suggested-title">Suggested For You</h2>
        <Link href="/explore?tab=people">See all</Link>
      </div>
      {loading || query.isPending ? (
        <WidgetSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : query.data.items.length ? (
        <ul className="suggested-list">
          {query.data.items.map((person) => (
            <li className="suggested-user" key={person.id}>
              <Link href={`/profile/${person.username}`} className="user-identity">
                <Avatar user={person} size={38} />
                <span>
                  <strong>{person.displayName}</strong>
                  <small>
                    {person.mutualFollowerCount > 0
                      ? `${person.mutualFollowerCount} mutual connection${person.mutualFollowerCount === 1 ? "" : "s"}`
                      : person.followsYou
                        ? "Follows you"
                        : `@${person.username}`}
                  </small>
                </span>
              </Link>
              <FollowButton id={person.id} following={person.isFollowing} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="widget-note">You’re connected with everyone we know of. Check back soon.</p>
      )}
    </section>
  );
}

export function RightSidebar() {
  return (
    <aside className="right-sidebar" aria-label="Activity and suggestions">
      <ActivityWidget />
      <SuggestedUsers />
      <footer className="sidebar-footer">Circle © {new Date().getFullYear()}</footer>
    </aside>
  );
}

export function MobileNav({ variant = "default", onCreate }: { variant?: "default" | "reels"; onCreate?: () => void } = {}) {
  const pathname = usePathname();
  const { user } = useSession();
  const unreadTotal = useUnreadTotal();
  const { on } = useFeatures();
  const items = [
    { href: "/", label: "Home", icon: Home },
    { href: "/explore", label: "Explore", icon: Compass },
    { href: "/reels", label: "Reels", icon: Clapperboard },
    { href: "/notifications", label: "Activity", icon: Bell, badge: unreadTotal },
    { href: user ? `/profile/${user.username}` : "/login", label: "Profile", icon: UserRound },
  ].filter((item) => item.href !== "/reels" || on("reels"));
  return (
    <nav className={`mobile-nav ${variant === "reels" ? "reels-mobile-nav" : ""}`} aria-label="Mobile navigation">
      {items.filter(item => variant !== "reels" || item.label !== "Activity").map(({ href, label, icon: Icon, badge }) => (
        <Fragment key={label}>
        {variant === "reels" && label === "Reels" && <button type="button" aria-label="Create post" onClick={onCreate}><PlusSquare size={23} /><span>Create</span></button>}
        <Link key={label} href={href} className={pathname === href ? "active" : ""} aria-current={pathname === href ? "page" : undefined}>
          <span className="mobile-nav-icon">
            <Icon size={21} aria-hidden="true" />
            <UnreadBadge count={badge} />
          </span>
          <span>{label}</span>
        </Link>
        </Fragment>
      ))}
    </nav>
  );
}

/** Shown to members while an administrator has switched the platform to read-only mode. */
export function ReadOnlyBanner() {
  const { readOnly, config } = useFeatures();
  if (!readOnly) return null;
  return (
    <div className="readonly-banner" role="status">
      <CircleAlert size={16} aria-hidden="true" />
      {config?.maintenanceMessage || "Circle is in read-only mode. You can browse, but posting and interactions are paused."}
    </div>
  );
}

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AppHeader />
      <ReadOnlyBanner />
      <div className="app-container app-grid">
        <LeftSidebar />
        <main id="main-content" className="main-column">
          {children}
        </main>
        <RightSidebar />
      </div>
      <MobileNav />
    </>
  );
}
