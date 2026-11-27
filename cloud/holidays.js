'use strict';
/*
 * Holiday rules for Munetios Calendar, served from /api/cloud/calendar/holidays.
 * Ported from the previous in-page rules so every device gets the same dates.
 *
 * Rule shapes:
 *   { name, date: [month, day] }                fixed date (month is 0-based)
 *   { name, nth: [month, weekday, n] }          nth weekday of a month (n = -1 for the last one)
 *   { name, easter: offsetDays }                relative to Western Easter Sunday
 *   { name, after: [ruleName, offsetDays] }     relative to another rule in the same set
 *   { name, election: true }                    first Tuesday after the first Monday in November
 */

function easterSunday(year) {
    const f = Math.floor;
    const a = year % 19, b = f(year / 100), c = year % 100, d = f(b / 4), e = b % 4;
    const g = f((b + 8) / 25), h = f((b - g + 1) / 3), i = f(c / 4), k = c % 4;
    const l = (19 * a + b - d - h + 15) % 30;
    const m = (32 + 2 * e + 2 * i - k - l) % 7;
    const n = f((a + 11 * l + 22 * m) / 451);
    const month = f((l + m - 7 * n + 114) / 31) - 1;
    const day = ((l + m - 7 * n + 114) % 31) + 1;
    return new Date(Date.UTC(year, month, day));
}

function nthWeekday(year, month, weekday, n) {
    if (n > 0) {
        const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
        return new Date(Date.UTC(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7));
    }
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const back = (lastDay.getUTCDay() - weekday + 7) % 7;
    return new Date(Date.UTC(year, month, lastDay.getUTCDate() - back));
}

const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

const US = [
    { name: "New Year's Day", date: [0, 1] },
    { name: 'Martin Luther King Jr. Day', nth: [0, 1, 3] },
    { name: 'Groundhog Day', date: [1, 2] },
    { name: 'Super Bowl Sunday', nth: [1, 0, 1] },
    { name: "Valentine's Day", date: [1, 14] },
    { name: "Presidents' Day", nth: [1, 1, 3] },
    { name: 'Mardi Gras', easter: -47 },
    { name: "St. Patrick's Day", date: [2, 17] },
    { name: "April Fools' Day", date: [3, 1] },
    { name: 'Good Friday', easter: -2 },
    { name: 'Easter', easter: 0 },
    { name: 'Earth Day', date: [3, 22] },
    { name: 'Administrative Professionals Day', nth: [3, 3, 4] },
    { name: 'Arbor Day', nth: [3, 5, -1] },
    { name: 'Cinco de Mayo', date: [4, 5] },
    { name: "Mother's Day", nth: [4, 0, 2] },
    { name: 'Memorial Day', nth: [4, 1, -1] },
    { name: 'Flag Day', date: [5, 14] },
    { name: "Father's Day", nth: [5, 0, 3] },
    { name: 'Juneteenth National Independence Day', date: [5, 19] },
    { name: 'Independence Day', date: [6, 4] },
    { name: 'Labor Day', nth: [8, 1, 1] },
    { name: 'Patriot Day', date: [8, 11] },
    { name: 'Constitution Day', date: [8, 17] },
    { name: 'Columbus Day', nth: [9, 1, 2] },
    { name: 'Halloween', date: [9, 31] },
    { name: 'Election Day', election: true },
    { name: 'Veterans Day', date: [10, 11] },
    { name: 'Thanksgiving Day', nth: [10, 4, 4] },
    { name: 'Black Friday', after: ['Thanksgiving Day', 1] },
    { name: 'Cyber Monday', after: ['Thanksgiving Day', 4] },
    { name: 'Pearl Harbor Remembrance Day', date: [11, 7] },
    { name: 'Christmas Eve', date: [11, 24] },
    { name: 'Christmas Day', date: [11, 25] },
    { name: 'Kwanzaa', date: [11, 26] },
    { name: "New Year's Eve", date: [11, 31] },
];

const fixed = list => list.map(([name, month, day]) => ({ name, date: [month, day] }));

const SETS = {
    US,
    CA: fixed([["New Year's Day", 0, 1], ['Canada Day', 6, 1], ['National Day for Truth and Reconciliation', 8, 30], ['Remembrance Day', 10, 11], ['Christmas Day', 11, 25], ['Boxing Day', 11, 26]]),
    GB: [{ name: "New Year's Day", date: [0, 1] }, { name: 'Good Friday', easter: -2 }, { name: 'Easter Monday', easter: 1 }, { name: 'Early May bank holiday', nth: [4, 1, 1] }, { name: 'Spring bank holiday', nth: [4, 1, -1] }, { name: 'Summer bank holiday', nth: [7, 1, -1] }, { name: 'Christmas Day', date: [11, 25] }, { name: 'Boxing Day', date: [11, 26] }],
    AU: fixed([["New Year's Day", 0, 1], ['Australia Day', 0, 26], ['Anzac Day', 3, 25], ['Christmas Day', 11, 25], ['Boxing Day', 11, 26]]),
    DE: [...fixed([['Neujahr', 0, 1], ['Tag der Arbeit', 4, 1], ['Tag der Deutschen Einheit', 9, 3], ['Weihnachtstag', 11, 25], ['Zweiter Weihnachtsfeiertag', 11, 26]]), { name: 'Karfreitag', easter: -2 }, { name: 'Ostermontag', easter: 1 }],
    FR: [...fixed([["Jour de l'an", 0, 1], ['Fête du Travail', 4, 1], ['Victoire 1945', 4, 8], ['Fête nationale', 6, 14], ['Assomption', 7, 15], ['Toussaint', 10, 1], ['Armistice 1918', 10, 11], ['Noël', 11, 25]]), { name: 'Lundi de Pâques', easter: 1 }],
    ES: [...fixed([['Año Nuevo', 0, 1], ['Epifanía del Señor', 0, 6], ['Día del Trabajo', 4, 1], ['Asunción de la Virgen', 7, 15], ['Fiesta Nacional de España', 9, 12], ['Todos los Santos', 10, 1], ['Día de la Constitución', 11, 6], ['Inmaculada Concepción', 11, 8], ['Navidad', 11, 25]]), { name: 'Viernes Santo', easter: -2 }],
    IT: [...fixed([['Capodanno', 0, 1], ['Epifania', 0, 6], ['Festa della Liberazione', 3, 25], ['Festa del Lavoro', 4, 1], ['Festa della Repubblica', 5, 2], ['Ferragosto', 7, 15], ['Ognissanti', 10, 1], ['Immacolata Concezione', 11, 8], ['Natale', 11, 25], ['Santo Stefano', 11, 26]]), { name: 'Pasquetta', easter: 1 }],
    PT: [...fixed([['Ano Novo', 0, 1], ['Dia da Liberdade', 3, 25], ['Dia do Trabalhador', 4, 1], ['Dia de Portugal', 5, 10], ['Assunção de Nossa Senhora', 7, 15], ['Implantação da República', 9, 5], ['Dia de Todos-os-Santos', 10, 1], ['Restauração da Independência', 11, 1], ['Imaculada Conceição', 11, 8], ['Natal', 11, 25]]), { name: 'Sexta-feira Santa', easter: -2 }],
    NL: [...fixed([['Nieuwjaarsdag', 0, 1], ['Koningsdag', 3, 27], ['Bevrijdingsdag', 4, 5], ['Eerste Kerstdag', 11, 25], ['Tweede Kerstdag', 11, 26]]), { name: 'Eerste Paasdag', easter: 0 }, { name: 'Tweede Paasdag', easter: 1 }],
    PL: fixed([['Nowy Rok', 0, 1], ['Święto Trzech Króli', 0, 6], ['Święto Pracy', 4, 1], ['Święto Konstytucji 3 Maja', 4, 3], ['Wszystkich Świętych', 10, 1], ['Święto Niepodległości', 10, 11], ['Boże Narodzenie', 11, 25], ['Drugi dzień Bożego Narodzenia', 11, 26]]),
    SE: fixed([['Nyårsdagen', 0, 1], ['Trettondedag jul', 0, 6], ['Första maj', 4, 1], ['Sveriges nationaldag', 5, 6], ['Juldagen', 11, 25], ['Annandag jul', 11, 26]]),
    NO: fixed([['Første nyttårsdag', 0, 1], ['Arbeidernes dag', 4, 1], ['Grunnlovsdag', 4, 17], ['Første juledag', 11, 25], ['Andre juledag', 11, 26]]),
    DK: fixed([['Nytårsdag', 0, 1], ['Grundlovsdag', 5, 5], ['Juledag', 11, 25], ['Anden juledag', 11, 26]]),
    FI: fixed([['Uudenvuodenpäivä', 0, 1], ['Loppiainen', 0, 6], ['Vappu', 4, 1], ['Itsenäisyyspäivä', 11, 6], ['Joulupäivä', 11, 25], ['Tapaninpäivä', 11, 26]]),
    HU: fixed([['Újév', 0, 1], ['Nemzeti ünnep', 2, 15], ['A munka ünnepe', 4, 1], ['Államalapítás ünnepe', 7, 20], ['Nemzeti ünnep (1956)', 9, 23], ['Karácsony', 11, 25], ['Karácsony másnapja', 11, 26]]),
    CZ: fixed([['Nový rok', 0, 1], ['Svátek práce', 4, 1], ['Den vítězství', 4, 8], ['Den české státnosti', 8, 28], ['Den vzniku samostatného československého státu', 9, 28], ['Štědrý den', 11, 24], ['1. svátek vánoční', 11, 25], ['2. svátek vánoční', 11, 26]]),
    TR: fixed([['Yılbaşı', 0, 1], ['Ulusal Egemenlik ve Çocuk Bayramı', 3, 23], ['Emek ve Dayanışma Günü', 4, 1], ['Atatürk’ü Anma, Gençlik ve Spor Bayramı', 4, 19], ['Zafer Bayramı', 7, 30], ['Cumhuriyet Bayramı', 9, 29]]),
    JP: [...fixed([["New Year's Day", 0, 1], ['Foundation Day', 1, 11], ["Emperor's Birthday", 1, 23], ['Showa Day', 3, 29], ['Constitution Memorial Day', 4, 3], ['Greenery Day', 4, 4], ["Children's Day", 4, 5], ['Mountain Day', 7, 11], ['Culture Day', 10, 3], ['Labor Thanksgiving Day', 10, 23]]), { name: 'Coming of Age Day', nth: [0, 1, 2] }, { name: 'Marine Day', nth: [6, 1, 3] }, { name: 'Respect for the Aged Day', nth: [8, 1, 3] }, { name: 'Sports Day', nth: [9, 1, 2] }],
    KR: fixed([["New Year's Day", 0, 1], ['Independence Movement Day', 2, 1], ["Children's Day", 4, 5], ['Memorial Day', 5, 6], ['Liberation Day', 7, 15], ['National Foundation Day', 9, 3], ['Hangul Day', 9, 9], ['Christmas Day', 11, 25]]),
    CN: fixed([["New Year's Day", 0, 1], ['Labour Day', 4, 1], ['National Day', 9, 1]]),
    IN: fixed([['Republic Day', 0, 26], ['Independence Day', 7, 15], ['Gandhi Jayanti', 9, 2]]),
    BD: fixed([["Language Martyrs' Day", 1, 21], ['Independence Day', 2, 26], ['Bengali New Year', 3, 14], ['Victory Day', 11, 16]]),
    RU: fixed([['New Year Holiday', 0, 1], ['Orthodox Christmas', 0, 7], ['Defender of the Fatherland Day', 1, 23], ["International Women's Day", 2, 8], ['Spring and Labour Day', 4, 1], ['Victory Day', 4, 9], ['Russia Day', 5, 12], ['Unity Day', 10, 4]]),
    SA: fixed([['Founding Day', 1, 22], ['Saudi National Day', 8, 23]]),
    MX: [...fixed([['Año Nuevo', 0, 1], ['Día del Trabajo', 4, 1], ['Día de la Independencia', 8, 16], ['Día de Muertos', 10, 2], ['Navidad', 11, 25]]), { name: 'Día de la Constitución', nth: [1, 1, 1] }, { name: 'Natalicio de Benito Juárez', nth: [2, 1, 3] }, { name: 'Día de la Revolución', nth: [10, 1, 3] }],
    BR: [...fixed([['Confraternização Universal', 0, 1], ['Tiradentes', 3, 21], ['Dia do Trabalho', 4, 1], ['Independência do Brasil', 8, 7], ['Nossa Senhora Aparecida', 9, 12], ['Finados', 10, 2], ['Proclamação da República', 10, 15], ['Natal', 11, 25]]), { name: 'Carnaval', easter: -47 }, { name: 'Sexta-feira Santa', easter: -2 }, { name: 'Corpus Christi', easter: 60 }],
};

const COUNTRIES = Object.keys(SETS);

function holidaysFor(country, year) {
    const rules = SETS[country];
    if (!rules || !Number.isInteger(year) || year < 1583 || year > 4099) return null;
    const resolved = new Map();
    const resolve = rule => {
        if (resolved.has(rule.name)) return resolved.get(rule.name);
        let date;
        if (rule.date) date = new Date(Date.UTC(year, rule.date[0], rule.date[1]));
        else if (rule.nth) date = nthWeekday(year, ...rule.nth);
        else if (rule.easter !== undefined) date = addDays(easterSunday(year), rule.easter);
        else if (rule.election) date = addDays(nthWeekday(year, 10, 1, 1), 1);
        else if (rule.after) {
            const base = rules.find(item => item.name === rule.after[0]);
            date = addDays(resolve(base), rule.after[1]);
        }
        resolved.set(rule.name, date);
        return date;
    };
    return rules
        .map(rule => ({ name: rule.name, date: resolve(rule).toISOString().slice(0, 10) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

module.exports = { COUNTRIES, holidaysFor, easterSunday };
