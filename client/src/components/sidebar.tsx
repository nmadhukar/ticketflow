import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { BookOpen, Brain, Building, ChevronDown, FolderOpen, LayoutDashboard, Plug, Settings, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";

interface SidebarProps { className?: string; onNavigate?: () => void }
const adminGroups = [
  { title: "management_title", icon: Users, items: ["users", "invitations", "teams"] },
  { title: "configuration_title", icon: Settings, items: ["company-console", "ai-settings"] },
  { title: "analytics_title", icon: Brain, items: ["ai-analytics", "learning-queue"] },
  { title: "content_title", icon: BookOpen, items: ["help", "policies", "guidelines"] },
  { title: "integrations_title", icon: Plug, items: ["sso", "ms-teams-integration", "developer-resources"] },
];

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation("navigation");
  const role = (user as any)?.role;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const active = (href: string) => href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);
  const linkClass = (selected: boolean) => cn(
    "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11",
    selected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );
  const navigation = [
    ...(role === "admin" ? [{ name: "dashboard", href: "/", icon: LayoutDashboard }] : []),
    { name: "tickets", href: "/tickets", icon: FolderOpen },
    ...(role === "admin" ? [{ name: "knowledge_base", href: "/knowledge-base", icon: BookOpen }] : []),
    ...(["admin", "manager"].includes(role) ? [{ name: "departments", href: "/departments", icon: Building }] : []),
    ...(["manager", "agent"].includes(role) ? [{ name: "teams", href: "/teams", icon: Users }] : []),
  ];
  return <div className={cn("flex h-full w-64 shrink-0 flex-col border-r bg-card", className)}>
    <div className="px-6 pb-4 pt-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Workspace</p>
      <p className="mt-1 text-sm font-medium">{role === "customer" ? "Your support desk" : "Support operations"}</p>
    </div>
    <nav aria-label="Main navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">
      {navigation.map(({ name, href, icon: Icon }) => {
        const selected = active(href) || (name === "tickets" && role !== "admin" && location === "/");
        return <Link key={name} href={href} onClick={onNavigate} aria-current={selected ? "page" : undefined} className={linkClass(selected)}>
          <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />{t(name)}
        </Link>;
      })}
      {role === "admin" && <div className="mt-6 border-t pt-5">
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Administration</p>
        {adminGroups.map(({ title, icon: Icon, items }) => {
          const selected = items.some((item) => active(`/admin/${item}`));
          const open = expanded[title] ?? selected;
          return <div key={title} className="mb-1">
            <button type="button" aria-expanded={open} aria-controls={`nav-${title}`} className={cn(linkClass(selected), "w-full text-left")} onClick={() => setExpanded((current) => ({ ...current, [title]: !open }))}>
              <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
              <span className="flex-1">{t(title)}</span>
              <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
            </button>
            {open && <div id={`nav-${title}`} className="ml-5 mt-1 space-y-1 border-l pl-3">
              {items.map((item) => <Link key={item} href={`/admin/${item}`} onClick={onNavigate} aria-current={active(`/admin/${item}`) ? "page" : undefined} className={linkClass(active(`/admin/${item}`))}>{t(item)}</Link>)}
            </div>}
          </div>;
        })}
      </div>}
    </nav>
    <nav aria-label="Help and preferences" className="space-y-1 border-t p-3">
      <Link href="/guides" onClick={onNavigate} aria-current={active("/guides") ? "page" : undefined} className={linkClass(active("/guides"))}><BookOpen aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />Help & guides</Link>
      <Link href="/settings" onClick={onNavigate} aria-current={active("/settings") ? "page" : undefined} className={linkClass(active("/settings"))}><Settings aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.8} />Settings</Link>
    </nav>
  </div>;
}
