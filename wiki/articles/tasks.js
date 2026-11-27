(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, faq, table, link } = W.helpers;
  W.register({
    slug: "tasks",
    title: "Munetios Tasks",
    short: "Tasks",
    logo: "images/logos/tasks.png",
    category: "productivity",
    tagline: "Fast, private tasks with categories, Board and Calendar views, a focus timer, templates, and natural quick add.",
    url: "/tasks/",
    updated: "2026-11-27",
    shots: [
      { src: "tasks-desktop.jpg", phone: "tasks-phone.jpg", caption: "Munetios Tasks with smart lists and views in the sidebar." },
      { src: "tasks-board-desktop.jpg", caption: "Board view with To do, In progress, and Completed columns." },
    ],
    facts: {
      developer: "Munetios",
      type: "Task manager",
      path: "/tasks/",
      platforms: "Web, installable app (PWA)",
      encryption: "End-to-end encrypted sync",
      sync: "Munetios Account (tasks, categories, attachments)",
      offline: "Yes",
      sharing: "Share tasks and custom task links",
      languages: "17 languages",
    },
    related: ["calendar", "supanotes", "meals", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "task_alt",
        html: `
<p><strong>Munetios Tasks</strong> lets you use categories, share, archive, favorite, and more. It's built to be fast, private, and secure. Tasks work offline in guest mode, and signing in syncs tasks, categories, and task attachments with end-to-end encryption. Local data is stored separately for each account and for guest mode.</p>
${pair("tasks-desktop.jpg", "tasks-phone.jpg", "Munetios Tasks.")}`,
      },
      {
        id: "lists", title: "Lists and views", icon: "list",
        html: `
<ul>
<li><strong>Smart lists:</strong> Tasks, Today, Upcoming, Overdue, Completed, Favorites, Categories, In Progress, Archived, and Trash.</li>
<li><strong>Board:</strong> drag tasks between To do, In progress, and Completed.</li>
<li><strong>Calendar:</strong> see tasks by due date and add a task on any day.</li>
<li><strong>Insights:</strong> active tasks, done today, done in the last 7 days, completion rate, current and best streak, time tracked, and breakdowns by category, priority, and tag.</li>
<li><strong>Templates</strong> and <strong>Later</strong>.</li>
</ul>
${fig("tasks-board-desktop.jpg", "The Board view.")}`,
      },
      {
        id: "quick-add", title: "Quick add", icon: "bolt",
        html: `
<p>Type naturally, for example <code>Call Sam tomorrow 3 AN !high #work</code>.</p>
${table(["Type", "Means"], [
  ["today, tomorrow, a weekday, 2026-12-01", "Due date"],
  ["3 AN or 15:00", "Time"],
  ["!low, !medium, !high, !urgent", "Priority"],
  ["#tag", "Tag"],
  ["@category", "Category"],
  ["~30m", "Time estimate"],
  ["every day, every week, every month", "Repeat"],
])}`,
      },
      {
        id: "details", title: "Task details", icon: "edit_note",
        html: `
<ul>
<li>Priority, repeat (with the next occurrence scheduled automatically), tags, estimate, links, description, category, status, and checklist items.</li>
<li><strong>Pin to top</strong>, <strong>snooze</strong> (in 15 minutes, 1 hour, 3 hours, tonight, tomorrow morning, or next week), duplicate, archive, mark as in progress, and save as template.</li>
<li><strong>Time tracking</strong> with a timer per task, compared with your estimate.</li>
<li>Sort by your own order, due date, priority, newest, or title; filter by priority and tag; select many tasks to move, archive, complete, or trash them. Undo is always available.</li>
</ul>`,
      },
      {
        id: "focus", title: "Focus timer and goals", icon: "timer",
        html: `<p>A built-in focus timer alternates focus sessions and breaks (lengths are configurable). Set a <strong>daily goal</strong> for how many tasks to finish, and build a <strong>streak</strong> of days you reach it.</p>`,
      },
      {
        id: "export", title: "Export and backup", icon: "download",
        html: `<p>Export your tasks as a calendar (<code>.ics</code>), a spreadsheet (<code>.csv</code>), or Markdown (<code>.md</code>). To move guest tasks into an account, export a backup as a guest, sign in, and import it. A command palette searches tasks, views, and actions.</p>`,
      },
      {
        id: "compare", title: "Compared with Google Tasks", icon: "compare_arrows",
        html: table(["Feature", "Munetios Tasks", "Google Tasks"], [
          ["Categories", true, false], ["Share tasks", true, false], ["Archive tasks", true, false], ["Favorite or pin tasks", true, "Yes (Starred)"],
          ["Cross-device sync", true, true], ["Mobile app", "Planned", true], ["Task search", true, false], ["Custom task links", true, false], ["Offline mode", true, false],
        ]),
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([["Are tasks in Calendar the same?", `Calendar includes a Tasks page, and Tasks exports due dates as .ics for ${link("calendar", "Munetios Calendar")}.`]]),
      },
    ],
  });
})();
