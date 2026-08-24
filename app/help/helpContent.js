export const helpApps = [
  {
    icon: "calendar_month",
    id: "calendar",
    image: "/calendar.png",
    name: "Munetios Calendar",
  },
  { icon: "videocam", id: "meet", image: "/meet.png", name: "Munetios Meet" },
  {
    icon: "task_alt",
    id: "tasks",
    image: "/documentation/assets/tasks.svg",
    name: "Munetios Tasks",
  },
  {
    icon: "library_books",
    id: "resources",
    image: "/favicon.ico",
    name: "Munetios Resources",
  },
];

export function getHelpArticle(documents, path = []) {
  const normalized = path.filter(Boolean).join("/");
  return (
    documents.find((article) => article.slug === normalized) || documents[0]
  );
}

export function getArticlesForApp(documents, appId) {
  return documents.filter((article) => article.appId === appId);
}
