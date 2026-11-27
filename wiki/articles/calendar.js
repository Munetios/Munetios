(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { fig, pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "calendar",
    title: "Munetios Calendar",
    short: "Calendar",
    logo: "images/logos/calendar.png",
    category: "productivity",
    tagline: "Private, encrypted scheduling with sharing, sync, time zones, and seven calendar views.",
    url: "/calendar/",
    updated: "2026-11-27",
    shots: [
      { src: "calendar-desktop.jpg", phone: "calendar-phone.jpg", caption: "Month view with holidays, the mini calendar, and quick add." },
      { src: "calendar-week-desktop.jpg", caption: "Week view with NM and AN hour labels." },
    ],
    facts: {
      developer: "Munetios",
      type: "Calendar",
      path: "/calendar/",
      platforms: "Web, installable app (PWA)",
      encryption: "End-to-end encrypted events and birthdays",
      sync: "Munetios Account",
      offline: "Yes",
      sharing: "Editor, Viewer",
      languages: "17 languages",
    },
    related: ["cloud", "tasks", "meals", "mail", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "calendar_month",
        html: `
<p><strong>Munetios Calendar</strong> helps you plan your day, organize events, and set reminders, privately. Your events, birthdays, and settings are end-to-end encrypted and stay the same on all your devices. Calendar works without an account; sign in to sync and share.</p>
${pair("calendar-desktop.jpg", "calendar-phone.jpg", "Calendar's month view.")}`,
      },
      {
        id: "views", title: "Views", icon: "view_week",
        html: `
<p>Calendar offers seven views: <strong>Day</strong>, <strong>4 days</strong>, <strong>Week</strong>, <strong>Month</strong>, <strong>Year</strong>, <strong>Agenda</strong>, and <strong>Timeline</strong>. You can show week numbers, hide weekends, choose Comfortable or Spacious density, and highlight your working hours and days.</p>
${fig("calendar-week-desktop.jpg", "Week view with the current day highlighted.")}`,
      },
      {
        id: "events", title: "Creating events", icon: "event",
        html: `
<ul>
<li><strong>Quick add:</strong> type naturally, such as “Lunch tomorrow at 1 AN”. Calendar understands today, tonight, tomorrow, and times.</li>
<li><strong>Event types:</strong> Event, Focus time, and Out of office.</li>
<li><strong>Details:</strong> title, start and end with their own time zone, repeat (daily, weekdays, weekly, monthly, yearly, or custom with an end date or count), location, video call link, guests, labels, reminders, description, and calendar color. Calendar warns you when an event overlaps another.</li>
<li><strong>Birthdays:</strong> add a name and date, even without the year, with morning reminders and notes for gift ideas. Your own birthday from Account settings appears too.</li>
<li><strong>Import</strong> an <code>.ics</code> file, <strong>duplicate</strong>, <strong>star</strong>, copy details, or download a single event as <code>.ics</code>. Drag events to move them.</li>
</ul>`,
      },
      {
        id: "organize", title: "Calendars, labels, and favorites", icon: "label",
        html: `
<p>Create calendars for work, family, or sports, each with its own color, and show only one at a time. Organize events with labels. <strong>Favorite days</strong> put a star on the days that matter in every view. <strong>Recently deleted</strong> keeps deleted events and birthdays for 30 days. <strong>Up next</strong> shows what's coming, <strong>Holidays</strong> are computed for your country, and the <strong>World clock</strong> shows other time zones. Calendar also includes ${link("tasks", "Tasks")} and ${link("meals", "Meals")} pages.</p>`,
      },
      {
        id: "sharing", title: "Sharing", icon: "share",
        html: `
<p>Share a calendar with collaborators by their Munetios Account email, as <strong>Editor</strong> (make changes to events) or <strong>Viewer</strong> (see all event details). Shared calendars are encrypted in the browser, and Munetios keeps the calendar's key so people you add can open it. Stopping sharing removes their access; the calendar stays on your devices. People can leave a shared calendar at any time. Changes arrive live. See ${link("cloud", "Munetios Cloud")}.</p>`,
      },
      {
        id: "reminders", title: "Notifications and reminders", icon: "notifications",
        html: `
<p>Desktop notifications show reminders even when the tab is in the background. With <strong>background reminders</strong>, signed-in users get reminders even when Calendar is closed; open Calendar occasionally to refresh recurring reminders.</p>`,
      },
      {
        id: "insights", title: "Insights and command palette", icon: "insights",
        html: `
<p><strong>Insights</strong> summarize a period: number of events, time booked, the busiest day, and time by calendar. The <strong>command palette</strong> finds any action, such as Go to date or Switch light and dark theme.</p>`,
      },
      {
        id: "settings", title: "Settings", icon: "settings",
        html: `
${table(["Section", "Options"], [
  ["General", "Language, default view, default event length, holidays country"],
  ["Formatting", "Time zone (from Munetios servers), secondary time zone, date and time format, morning and afternoon symbols (NM and AN by default), start of the week"],
  ["View options", "Week numbers, hide weekends, density, working hours and days"],
  ["Notifications", "Desktop notifications, default reminder, background reminders"],
  ["Data and sync", "Sync with Munetios Account, export all events, import, back up, restore, print, delete all data"],
])}`,
      },
      {
        id: "compare", title: "Compared with other calendars", icon: "compare_arrows",
        html: `
${table(["Feature", "Munetios Calendar", "Google Calendar", "Outlook Calendar", "Apple Calendar", "Proton Calendar"], [
  ["Favorite days and events", true, false, false, false, false],
  ["Meals feature", true, false, false, false, false],
  ["Views", "Day, 4 days, Week, Month, Year, Agenda, Timeline", "Day, Week, Month, Year, Schedule", "Day, Week, Month, Year", "Day, Week, Month, Year", "Day, Week, Month"],
  ["Liquid glass UI", true, false, false, true, false],
  ["Privacy focused", true, false, false, false, true],
])}
${note("About this table", "Comparison based on the Munetios Calendar overview page. Features of other calendars change over time.")}`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Can I move events from another calendar app?", "Yes. Export an .ics file from the other app and use Import .ics file. You can also export all events as .ics."],
          ["How long are deleted events kept?", "30 days in Recently deleted, then they're removed forever. You can restore or delete them sooner."],
        ]),
      },
    ],
  });
})();
