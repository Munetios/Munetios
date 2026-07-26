const apps = [
  {
    name: "Maps",
    nameKey: "landingAppMapsName",
    icon: "map",
    href: "https://maps.munetios.com/",
    descriptionKey: "landingAppMapsDescription",
  },
  {
    name: "Calendar",
    nameKey: "landingAppCalendarName",
    icon: "calendar_month",
    href: "https://calendar.munetios.com/",
    descriptionKey: "landingAppCalendarDescription",
  },
  {
    name: "Notes",
    nameKey: "landingAppNotesName",
    icon: "notes",
    href: "https://notes.munetios.com/",
    descriptionKey: "landingAppNotesDescription",
  },
  {
    name: "Tasks",
    nameKey: "landingAppTasksName",
    icon: "check_circle",
    href: "https://tasks.munetios.com/",
    descriptionKey: "landingAppTasksDescription",
  },
  {
    name: "Docs",
    nameKey: "landingAppDocsName",
    icon: "description",
    href: "https://docs.munetios.com/",
    descriptionKey: "landingAppDocsDescription",
  },
  {
    name: "Photos",
    nameKey: "landingAppPhotosName",
    icon: "photo_library",
    href: "https://photos.munetios.com/",
    descriptionKey: "landingAppPhotosDescription",
  },
  {
    name: "Notebook",
    nameKey: "landingAppNotebookName",
    icon: "auto_stories",
    href: "https://notebook.munetios.com/",
    descriptionKey: "landingAppNotebookDescription",
  },
  {
    name: "Weather",
    nameKey: "landingAppWeatherName",
    icon: "partly_cloudy_day",
    href: "https://weather.munetios.com/",
    descriptionKey: "landingAppWeatherDescription",
  },
];

export default function LandingAppGrid({ copy }) {
  return (
    <section id="products" className="px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1150px]">
        <div className="mb-8 max-w-[720px]">
          <p
            className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent)]"
            data-translate="landingAppsKicker"
          >
            {copy.landingAppsKicker}
          </p>
          <h2
            className="mt-3 text-3xl font-bold tracking-normal text-white sm:text-4xl"
            data-translate="landingAppsTitle"
          >
            {copy.landingAppsTitle}
          </h2>
          <p
            className="mt-4 text-base leading-7 text-[var(--muted)]"
            data-translate="landingAppsDescription"
          >
            {copy.landingAppsDescription}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {apps.map((app) => (
            <a
              className="liquid-glass group flex min-h-[176px] flex-col justify-between rounded-lg p-5 transition hover:-translate-y-0.5 hover:bg-purple-700/40"
              href={app.href}
              key={app.name}
              rel="noreferrer"
              target="_blank"
            >
              <div>
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/10 text-[var(--accent)]">
                  <icon>{app.icon}</icon>
                </div>
                <h3
                  className="text-lg font-semibold text-white"
                  data-translate={app.nameKey}
                >
                  {copy[app.nameKey] || app.name}
                </h3>
                <p
                  className="mt-2 text-sm leading-6 text-white/65"
                  data-translate={app.descriptionKey}
                >
                  {copy[app.descriptionKey]}
                </p>
              </div>
              <span
                className="mt-5 text-sm font-semibold text-white/75 transition group-hover:text-white"
                data-translate="landingOpenApp"
              >
                {copy.landingOpenApp}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
