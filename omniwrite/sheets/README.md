# Sheets persistence checks

Cell and formula-bar drafts are included in encrypted autosave snapshots. Enter commits the edit to the workbook model; Escape restores the original value and saves that cancellation. Saves run in order, retain failed revisions for retry, and show success only after IndexedDB commits. A pending write activates the browser's normal leave-page safeguard. Concurrent first-use tabs select their encryption key within one IndexedDB write transaction.

The browser regression tests use fresh, isolated storage and mock account requests. They do not read or modify existing browser profiles. Install Playwright in a temporary test directory and run the checks from the project root in PowerShell:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'
npm install --prefix "$env:TEMP\omni-sheets-check" --no-package-lock --no-audit --no-fund playwright
$env:SHEETS_PLAYWRIGHT_MODULE="$env:TEMP\omni-sheets-check\node_modules\playwright"
npm run test:sheets
```

The tests use installed Google Chrome by default. Set `SHEETS_BROWSER_PATH` to a local Chromium executable to use that instead.
