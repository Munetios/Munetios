// Old standalone Sheets links forward to the same place inside OmniWrite.
(function () {
    'use strict';
    var hash = location.hash || '';
    var match = /^#\/sheet\/([A-Za-z0-9._-]+)/.exec(hash);
    var target = '../';
    if (match) target = '../#/sheet/' + match[1];
    else if (hash === '#/new') target = '../#/sheets/new';
    else if (hash === '#/templates') target = '../#/sheets/templates';
    else if (hash === '#/trash') target = '../#/trash';
    location.replace(target);
})();
