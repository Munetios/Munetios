"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigationItems = [
  { href: "/apps/tasks", icon: "checklist", key: "tasksAllTasks" },
  {
    href: "/apps/tasks/in-progress",
    icon: "pending_actions",
    key: "tasksInProgress",
  },
  {
    href: "/apps/tasks/completed",
    icon: "task_alt",
    key: "tasksCompleted",
  },
  { href: "/apps/tasks/favorites", icon: "star", key: "tasksFavorites" },
  { href: "/apps/tasks/shared", icon: "group", key: "tasksShared" },
  { href: "/apps/tasks/archived", icon: "archive", key: "tasksArchived" },
  {
    href: "/apps/tasks/categories",
    icon: "category",
    key: "tasksCategories",
  },
  { href: "/apps/tasks/trash", icon: "delete", key: "tasksTrash" },
];

export default function TasksSidebar({ copy, expanded, onNavigate }) {
  const pathname = usePathname();

  return (
    <aside
      aria-label={copy.tasksSidebarNavigation}
      className="tasks-sidebar liquid-glass"
      data-expanded={expanded ? "true" : "false"}
    >
      <nav
        aria-label={copy.tasksSidebarNavigation}
        className="tasks-sidebar-navigation"
      >
        {navigationItems.map((item) => {
          const isCurrent =
            item.href === "/apps/tasks"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const content = (
            <>
              <span className="tasks-sidebar-icon">
                <icon>{item.icon}</icon>
              </span>
              <span className="tasks-nav-label">{copy[item.key]}</span>
            </>
          );

          return (
            <Link
              aria-current={isCurrent ? "page" : undefined}
              aria-label={copy[item.key]}
              className="tasks-sidebar-item"
              href={item.href}
              key={item.key}
              onClick={onNavigate}
              title={copy[item.key]}
            >
              {content}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
