const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const text = value => String(value).replace(/[&<>"']/g, character => entities[character]);

export function mailHtml({ title, body, code, link, linkLabel }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:#160c32;color:#f5efff;font:400 17px/1.6 'Munetios UI v4 Font',Arial,sans-serif;font-feature-settings: normal;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#281749;border:1px solid #674f94;border-radius:28px"><tr><td style="padding:28px">
<p style="margin:0 0 12px;color:#d1b9ff;font-size:18px">Munetios</p>
<h1 style="margin:0 0 16px;font-size:30px;line-height:1.25;font-weight:400">${text(title)}</h1>
${code ? `<p style="margin:0 0 18px;padding:12px 18px;background:#3c2766;border:1px solid #8665bd;border-radius:18px;color:#fff;font:400 28px/1.4 monospace;letter-spacing:.2em" dir="ltr">${text(code)}</p>` : ''}
<p style="margin:0;color:#eadfff;overflow-wrap:anywhere">${text(body).replace(/\r?\n/g, '<br>')}</p>
${link ? `<p style="margin:20px 0 0"><a href="${text(link)}" style="display:inline-block;padding:10px 20px;border-radius:30px;background:#dbc1ff;color:#2b174b;text-decoration:none">${text(linkLabel)}</a></p>` : ''}
</td></tr></table></td></tr></table>
</body></html>`;
}
