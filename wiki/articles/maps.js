(() => {
  "use strict";
  const W = window.MunetiosWiki;
  const { pair, note, faq, table, link } = W.helpers;
  W.register({
    slug: "maps",
    title: "Munetios Maps",
    short: "Maps",
    logo: "images/logos/maps.png",
    category: "navigation",
    tagline: "Maps with directions, markers, live traffic, satellite and night imagery, and trips to the Moon and planets.",
    url: "/maps/",
    updated: "2026-11-27",
    shots: [
      { src: "maps-desktop.jpg", phone: "maps-phone.jpg", caption: "The globe view with the Moon, directions, and layers." },
    ],
    facts: {
      developer: "Munetios",
      type: "Maps and navigation",
      path: "/maps/",
      platforms: "Web",
      encryption: "End-to-end encrypted markers and Home address",
      sync: "Munetios Account",
      offline: "Saved views and markers on this device",
      languages: "17 languages",
    },
    related: ["search", "privacy", "accounts"],
    sections: [
      {
        id: "overview", title: "Overview", icon: "map",
        html: `
<p><strong>Munetios Maps</strong> lets you explore the world, get directions, save markers and bookmarks, and see live traffic, all with a custom purple map style. Your Home address and markers sync with end-to-end encryption, and live traffic is built from anonymous reports.</p>
${pair("maps-desktop.jpg", "maps-phone.jpg", "Munetios Maps on a globe.")}`,
      },
      {
        id: "navigate", title: "Search, directions, and navigation", icon: "directions",
        html: `
<ul>
<li><strong>Search</strong> places by name or by voice.</li>
<li><strong>Directions</strong> with turn-by-turn steps, sound on or off, and route export as a GPX file.</li>
<li><strong>Near Me</strong> and <strong>History</strong> of places you looked up.</li>
<li><strong>Home:</strong> add your home (Casa in Spanish) for one-tap directions. It's saved to your Munetios Account with end-to-end encryption, or on this device when signed out.</li>
</ul>`,
      },
      {
        id: "markers", title: "Markers and saved views", icon: "location_on",
        html: `<p>Drop <strong>markers</strong>, rename them, search them, and sort by newest, name, or nearest to you (showing distance and direction). Import and export markers as files. <strong>Saved views</strong> remember places you framed so you can return to them.</p>`,
      },
      {
        id: "tools", title: "Map tools", icon: "straighten",
        html: `
${table(["Tool", "What it does"], [
  ["Measure distance and area", "Tap points to measure a distance, or draw a shape to see its area and perimeter"],
  ["Go to coordinates", "Decimal degrees (40.7128, -74.0060), degrees-minutes-seconds, or a Plus Code (87G7PX7V+4H)"],
  ["Coordinate grid and formats", "Switch how coordinates are shown, such as DD"],
  ["Sunrise and sunset", "Times at the map center, day length, and where the sun is right now"],
  ["Day and night", "Shades the night side of Earth for the current time"],
  ["Auto dark map", "The map turns dark after sunset"],
  ["Share this view", "Copy a link to exactly what you see"],
  ["Save map image", "Download the view as a PNG"],
  ["3D view, reset to north, full screen", "Tilt and rotate the map"],
])}`,
      },
      {
        id: "layers", title: "Layers and imagery", icon: "layers",
        html: `
<p>Switch between the map and <strong>satellite</strong> imagery, and turn on <strong>night on satellite</strong> to see city lights. Satellite tiles come from the Munetios Maps server: Sentinel-2 cloudless imagery (CC BY 4.0, up to zoom 14), NASA Blue Marble, and NASA Black Marble city lights (public domain). Each tile is downloaded once and saved, and servers can be set to serve only their own imagery.</p>`,
      },
      {
        id: "traffic", title: "Live traffic", icon: "traffic",
        html: `
<p>Live traffic colors roads from fast to slow using anonymous speed reports that people choose to share while navigating.</p>
<ul>
<li>Reports carry no account, device, or trip identifier.</li>
<li>The first and last 500 m of every trip are never sent.</li>
<li>Reports are kept for 15 minutes. Only each road cell's long-run free-flow speed is saved.</li>
<li>A road segment needs at least two reports before it appears. When there are no live reports, Maps shows typical traffic for the time.</li>
</ul>
${note("You choose", "Speed sharing is off until you turn it on with Share speeds.", "success")}`,
      },
      {
        id: "space", title: "The Moon, planets, and beyond", icon: "public",
        html: `<p>Visit the <strong>Moon</strong> with NASA LRO imagery and see its current phase. Zoom out to space to explore the solar system (Mercury to Pluto, with distance from Earth and the Sun, diameter, year and day length, and moons), then nearby stars, the Milky Way, the Local Group, the Andromeda and Triangulum galaxies, and the observable universe. Time controls let you speed up or pause the motion of the planets.</p>`,
      },
      {
        id: "faq", title: "Frequently asked questions", icon: "help",
        html: faq([
          ["Why is traffic missing in my area?", "Traffic appears after enough people share anonymous speeds there. Zoom in to see it."],
          ["Is Maps part of Ganetios?", `This article covers Munetios Maps, the maps app in the Munetios platform. ${link("munetios", "Munetios")} and Ganetios are separate brands.`],
        ]),
      },
    ],
  });
})();
