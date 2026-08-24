import { t } from "../../i18n";

const loadingCss = `
  .tasks-route-loading {
    align-items: center;
    display: flex;
    justify-content: center;
    min-height: 100%;
  }

  .tasks-route-loading > span {
    animation: tasks-route-loading-pulse 1s ease-in-out infinite alternate;
    color: rgb(233 213 255 / .9);
  }

  @keyframes tasks-route-loading-pulse {
    from { opacity: .48; }
    to { opacity: 1; }
  }
`;

export default function TasksLoading() {
  const copy = t();
  return (
    <output aria-live="polite" className="tasks-route-loading">
      <style>{loadingCss}</style>
      <span>{copy.loading}...</span>
    </output>
  );
}
