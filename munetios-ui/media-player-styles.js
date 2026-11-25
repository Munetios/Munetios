(() => {
  "use strict";
  if (window.MunetiosMediaPlayerStyles) return;
  const css = `
        :host{display:block;position:relative;color:#fff;font-family:'Munetios UI v4 Font',sans-serif;font-feature-settings:'liga' 0;line-height:1.4}
        *{box-sizing:border-box} [hidden]{display:none!important} button,input{font:inherit}button{cursor:pointer;color:inherit}button:disabled{opacity:.4;cursor:default}
        .surface{position:relative;width:100%;background:#05040c;border-radius:inherit;isolation:isolate;container-type:inline-size}::slotted(video){display:block!important;width:100%!important;height:auto;max-width:100%;margin:0!important;border-radius:inherit;background:#05040c}
        .liquid-glass{background:rgba(34,13,66,.45);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(2px) saturate(140%);-webkit-backdrop-filter:blur(2px) saturate(140%);box-shadow:0 4px 16px rgba(0,0,0,.18);border-radius:999px}
        icon{font-family:'Material Symbols Rounded';font-weight:normal;font-style:normal;font-size:23px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga' 1;font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;pointer-events:none}
        .controls{position:absolute;left:10px;right:10px;bottom:10px;display:flex;align-items:center;gap:8px;background:transparent;border:0;box-shadow:none;backdrop-filter:none;z-index:3;opacity:0;transition:opacity .18s;pointer-events:none}
        :host([data-controls-visible]) .controls{opacity:1;pointer-events:auto}
        .button{display:grid;place-items:center;flex:0 0 50px;width:50px;height:50px;min-width:0;padding:0;border:0;background:transparent;border-radius:50%}.button:hover{background:rgba(167,92,255,.32)}.button.liquid-glass{border:1px solid rgba(255,255,255,.18);background:rgba(34,13,66,.45)}
        button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid #c59aff;outline-offset:3px}
        .volume{position:relative;flex:0 0 50px;z-index:4}.volume-tray{position:absolute;bottom:calc(100% + 8px);left:0;width:172px;padding:10px 14px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s}
        .volume::before{content:'';position:absolute;left:0;bottom:100%;width:172px;height:12px;display:none}.volume:hover::before,.volume:focus-within::before,.volume.expanded::before{display:block}
        .volume:hover .volume-tray,.volume:focus-within .volume-tray,.volume.expanded .volume-tray{opacity:1;visibility:visible;pointer-events:auto}
        :host(:not([data-controls-visible])) .volume-tray{opacity:0;visibility:hidden;pointer-events:none}
        .timeline{display:flex;align-items:center;min-width:48px;flex:1;padding:0 16px;height:50px}.timestamp{flex:0 0 auto;height:50px;padding:0 12px;font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 1px 3px #000;direction:ltr;unicode-bidi:isolate}.right{display:flex;align-items:center;gap:2px;padding:2px;flex:0 0 auto}
        input[type=range]{appearance:none;-webkit-appearance:none;display:block;width:100%;min-width:0;height:34px;margin:0;padding:0;border:0;border-radius:0;background:transparent;cursor:pointer;touch-action:pan-y}
        input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(to right,#bd8cff 0 var(--fill,0%),rgba(255,255,255,.28) var(--fill,0%) 100%)}
        input[type=range]::-moz-range-track{height:6px;border-radius:999px;background:rgba(255,255,255,.28)}input[type=range]::-moz-range-progress{height:6px;border-radius:999px;background:#bd8cff}
        input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:18px;height:18px;margin-top:-6px;border:2px solid #e0caff;border-radius:50%;background:#9560df;box-shadow:0 2px 5px rgba(0,0,0,.25)}
        input[type=range]::-moz-range-thumb{width:14px;height:14px;border:2px solid #e0caff;border-radius:50%;background:#9560df}
        .panel{position:fixed;inset:auto;margin:0;width:min(310px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow-y:auto;padding:12px;border-radius:24px;color:#fff;font-size:14px;line-height:1.4;z-index:1000001}
        .panel:not([hidden]){display:grid;gap:8px}.panel header{display:flex;align-items:center;gap:8px;min-width:0}.panel h3{flex:1;min-width:0;margin:0;font-size:17px;font-weight:500}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;width:100%;padding:8px 10px;border:0;border-radius:14px;color:inherit;background:rgba(83,41,132,.28);text-align:start;font:inherit}.row:hover{background:rgba(146,82,255,.35)}.row span:first-child{min-width:0}
        .row-label{display:flex;align-items:center;gap:10px;min-width:0}.row-label icon{flex:0 0 auto}.row-label span{min-width:0}.switch{flex:0 0 38px;width:38px;height:23px;border-radius:999px;background:rgba(255,255,255,.25);padding:3px}.switch::after{content:'';display:block;width:17px;height:17px;border-radius:50%;background:#fff;transition:transform .15s}.row[aria-checked=true] .switch{background:#8950cc}.row[aria-checked=true] .switch::after{transform:translateX(15px)}
        textarea{width:100%;min-height:150px;resize:vertical;padding:12px;border:1px solid rgba(255,255,255,.24);border-radius:16px;background:rgba(25,10,48,.50);color:#fff;font:inherit;font-size:16px;line-height:1.5}.hint{margin:0;color:#e5d6fa;font-size:13px;line-height:1.5}.controls icon{font-size:28px}
        .speed-value{font-size:24px;font-variant-numeric:tabular-nums;text-align:center;padding:8px}.speed-limits{display:flex;justify-content:space-between;color:#e2cfff;font-size:12px}.presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}.preset{min-height:38px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(83,41,132,.28)}.preset[aria-pressed=true]{background:#7942bd;border-color:#cba3ff}
        .captions{position:absolute;left:50%;top:78%;transform:translate(-50%,-50%);max-width:90%;padding:5px 10px;border-radius:8px;background:rgba(0,0,0,.50);color:#fff;text-align:center;white-space:pre-line;font-size:clamp(14px,3cqw,25px);line-height:1.45;text-shadow:0 1px 3px #000;cursor:grab;touch-action:none;user-select:none;z-index:2}.captions:active{cursor:grabbing}.notice{position:absolute;top:12px;left:12px;right:12px;padding:8px 12px;border-radius:12px;z-index:5;font-size:14px;line-height:1.5}
        :host(:fullscreen){width:100%!important;height:100%!important;max-width:none!important;margin:0!important;background:#05040c;border-radius:0!important}:host(:fullscreen) .surface{height:100%;display:grid;place-items:center}:host(:fullscreen) ::slotted(video){height:100%;max-height:100dvh;object-fit:contain;border-radius:0}
        .volume-setting{display:grid;gap:4px;padding:8px 10px;border-radius:14px;background:rgba(83,41,132,.28)}.volume-setting .row-label{gap:8px}.volume-setting .button{width:38px;height:38px;flex-basis:38px}
        :host([data-media-type=audio]) .surface{background:transparent;padding:0 0 8px}
        ::slotted(audio){display:none!important}
        .audio-title{display:flex;align-items:center;gap:10px;min-width:0;padding:10px 12px;color:#e4cfff;font-size:14px;line-height:1.5}
        .audio-title span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .audio-title icon{color:#bd8cff;flex-shrink:0}
        :host([data-media-type=audio]) .controls{position:relative;left:auto;right:auto;bottom:auto;width:100%;opacity:1;pointer-events:auto}
        :host([data-media-type=audio]) .notice{position:relative;inset:auto;margin-top:8px}
        @container(max-width:640px){.controls{left:8px;right:8px;bottom:8px;gap:6px}.button{width:44px;height:44px;flex-basis:44px}.volume{width:44px;flex-basis:44px}.timeline{height:44px;padding:0 12px}.right{gap:0}.right .button{width:44px;flex-basis:44px}.timestamp{height:44px;font-size:13px;padding:0 10px}.controls icon{font-size:26px}}
        @container(max-width:220px){.controls{flex-wrap:wrap}.timeline{order:5;flex-basis:100%}.right{margin-left:auto}}
        @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    `;
  const sheet =
    typeof CSSStyleSheet === "function" &&
    "replaceSync" in CSSStyleSheet.prototype
      ? new CSSStyleSheet()
      : null;
  sheet?.replaceSync(css);
  window.MunetiosMediaPlayerStyles = Object.freeze({ css, sheet });
})();
