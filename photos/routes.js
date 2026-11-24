(() => {
  "use strict";

  const sections = "library|memories|favorites|videos|screenshots|albums|archive|locked|trash|duplicates|storage|recap";
  const id = "[A-Za-z0-9_~-]+";
  const pathPattern = new RegExp(`^/photos(?:/(${sections})|/(album|shared|photo)/(${id}))?/?$`);

  function parse(pathname) {
    const match = pathPattern.exec(pathname);
    if (!match) return null;
    const [, section, kind, key] = match;
    if (kind === "photo") return { media: key };
    return { section: kind ? `${kind}:${key}` : section || "library" };
  }

  function sectionPath(section) {
    if (section === "library") return "/photos/";
    return "/photos/" + section.replace(":", "/");
  }

  const routes = { pathPattern, parse, sectionPath };
  if (typeof module === "object" && module.exports) module.exports = routes;
  else globalThis.MunetiosPhotosRoutes = routes;
})();
