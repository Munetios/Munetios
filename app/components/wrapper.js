import { t } from "../i18n";

export default function Wrapper({
  ariaLabel,
  as: Element = "section",
  children = null,
  className = "",
  contentClassName = "",
  title = "",
}) {
  const copy = t("en");
  const label = ariaLabel || title || copy.wrapperRegionLabel;

  return (
    <Element
      aria-label={label}
      className={`liquid-glass overflow-y-auto rounded-2xl border border-white/10 bg-purple-950/20! p-3 text-white ${className}`}
    >
      {title
        ? <h2 className="text-base font-bold leading-6">{title}</h2>
        : null}
      <div
        className={`overflow-y-auto ${title ? `mt-3 ${contentClassName}` : contentClassName}`}
      >
        {children}
      </div>
    </Element>
  );
}

// to make compoment use <Wrapper> </Wrapper>
