import type { UserRole } from "@cleanops/shared";
import {
  LayoutDashboard,
  LogOut,
  Route,
  Settings,
  Users,
  WalletCards
} from "lucide-react";

export type OperatorView = "dashboard" | "routes" | "payments" | "staff" | "admin";

const navItems: Array<{ id: OperatorView; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "routes", label: "Routes", icon: Route },
  { id: "payments", label: "Payments", icon: WalletCards },
  { id: "staff", label: "Staff", icon: Users },
  { id: "admin", label: "Admin", icon: Settings }
];

function shortRole(role: UserRole) {
  if (role === "operator_owner") {
    return "owner";
  }

  if (role === "operations_supervisor") {
    return "supervisor";
  }

  return role.replace("_", " ");
}

export default function OperatorSidebar({
  activeView,
  fullName,
  onOpenProfile,
  onSelectView,
  onSignOut,
  role
}: {
  activeView: OperatorView;
  fullName: string;
  onOpenProfile: () => void;
  onSelectView: (view: OperatorView) => void;
  onSignOut: () => void;
  role: UserRole;
}) {
  const firstName = fullName.split(" ")[0] || fullName;

  return (
    <aside className="operator-sidebar">
      <div className="sidebar-brand">
        <strong className="sidebar-wordmark">CleanOps</strong>
        <span className="sidebar-tagline">Next to Godliness</span>
      </div>

      <nav aria-label="Operator workflow sections" className="sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activeView === item.id ? "sidebar-nav-item active" : "sidebar-nav-item"}
              key={item.id}
              onClick={() => onSelectView(item.id)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-user" onClick={onOpenProfile} type="button">
          <span className="avatar-chip" aria-hidden="true">
            {firstName.slice(0, 1)}
          </span>
          <span>
            {firstName} · {shortRole(role)}
          </span>
        </button>
        <button className="sidebar-nav-item" onClick={onSignOut} type="button">
          <LogOut aria-hidden="true" size={18} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
