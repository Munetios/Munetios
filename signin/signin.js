(() => {
    'use strict';
    const root = document.documentElement;
    const catalog = window.MunetiosSigninTranslations;
    const form = document.getElementById('signinForm');
    const language = document.getElementById('language');
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    const confirmation = document.getElementById('confirmPassword');
    const emailCode = document.getElementById('emailCode');
    const emailCodeButton = document.getElementById('sendEmailCode');
    const emailCodeNotice = document.getElementById('emailCodeNotice');
    const toggle = document.getElementById('passwordToggle');
    const submit = document.getElementById('signinSubmit');
    const modeButton = document.getElementById('modeButton');
    const signinModeButton = document.getElementById('signinModeButton');
    const signinBody = document.getElementById('signinBody');
    const status = document.getElementById('signinStatus');
    const themeButton = document.getElementById('themeButton');
    const sessionPanel = document.getElementById('sessionPanel');
    const Account = window.MunetiosAccount;
    const resetForm = document.getElementById('resetForm');
    const resetEmail = document.getElementById('resetEmail');
    const resetCode = document.getElementById('resetCode');
    const resetPassword = document.getElementById('resetPassword');
    const resetConfirm = document.getElementById('resetConfirm');
    const resetFactor = document.getElementById('resetFactor');
    const resetSubmit = document.getElementById('resetSubmit');
    const resetError = document.getElementById('resetError');
    const forgot = document.getElementById('forgotPassword');
    const forgotEmail = document.getElementById('forgotEmail');
    const forgotEmailResult = document.getElementById('forgotEmailResult');
    const google = document.getElementById('googleSignIn');
    const googleDivider = document.getElementById('googleSignInDivider');
    let googleEnabled = false;
    const params = new URLSearchParams(location.search);
    const googleFactor = params.get('google') === 'factor';
    const adding = params.get('add') === '1';
    // Only same-site paths are allowed as a return destination.
    const rawContinue = params.get('continue') || '';
    const omniWriteHost = location.hostname === 'write.munetios.com';
    const defaultDestination = location.hostname === 'accounts.munetios.com' ? 'https://write.munetios.com/' : '';
    const continueTo = /^\/(?!\/)[^\s\\]*$/.test(rawContinue) && !rawContinue.startsWith('/signin')
        ? rawContinue + (rawContinue.includes('#') ? '' : location.hash) : '';
    let locale = 'en', creating = false, verifying = false, busy = false, statusKey = '';
    // New accounts: a display name (required) and an optional birthday for Munetios Calendar.
    const displayName = document.getElementById('displayName');
    const birthdayButton = document.getElementById('birthdayButton');
    const birthdayValue = document.getElementById('birthdayValue');
    const birthdayClear = document.getElementById('birthdayClear');
    let birthday = '';
    function paintBirthday() {
        birthdayValue.dataset.placeholder = t('birthdayPlaceholder');
        birthdayClear.setAttribute('aria-label', t('birthdayClear'));
        birthdayClear.title = t('birthdayClear');
        birthdayClear.hidden = !birthday;
        if (!birthday) { birthdayValue.textContent = ''; return; }
        const [y, m, d] = birthday.split('-').map(Number);
        try { birthdayValue.textContent = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); }
        catch { birthdayValue.textContent = birthday; }
    }
    function showProfileFields() {
        document.getElementById('displayNameField').hidden = !creating;
        document.getElementById('birthdayField').hidden = !creating;
        displayName.disabled = !creating;
        displayName.required = creating;
        birthdayButton.disabled = !creating;
    }
    let resetStep = '', resetProof = '', resetErrorKey = '';
    const isInternal = () => email.value.trim().toLowerCase().endsWith('@munetios.com');
    const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
    const set = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
    const t = key => catalog[locale][key] ?? window.MunetiosAccountStrings.catalog[locale]?.[key];
    // Any language tag → one of the 17 global locales.
    function resolveLocale(value) {
        const resolved = window.MunetiosAccountStrings?.resolveLocale?.(value) || 'en-US';
        return catalog[resolved] ? resolved : 'en-US';
    }
    function updateTheme() {
        const light = root.dataset.muTheme === 'light';
        themeButton.setAttribute('aria-label', t(light ? 'darkTheme' : 'lightTheme'));
        themeButton.querySelector('.mu-icon').textContent = light ? 'dark_mode' : 'light_mode';
        root.style.colorScheme = light ? 'light' : 'dark';
    }
    function renderLanguage() {
        google.hidden = googleFactor || !googleEnabled || Boolean(resetStep) || verifying;
        if (googleDivider) googleDivider.hidden = google.hidden;
        document.querySelector("#authCodeField label").textContent = Account.t("factorOrRecovery");
        root.lang = locale;
        root.dir = locale === 'ar' ? 'rtl' : 'ltr';
        document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
        paintBirthday();
        updateEmailSuggestion();
        document.title = `${t(creating ? 'createAccount' : 'signIn')} · ${omniWriteHost ? 'OmniWrite' : 'Munetios'}`;
        document.getElementById('signinTitle').textContent = t(verifying ? 'emailVerificationTitle' : creating ? 'createAccount' : 'signIn');
        if (resetStep) {
            document.getElementById('signinTitle').textContent = t(resetStep === 'lookup' ? 'forgotEmail' : 'resetPasswordTitle');
            document.getElementById('resetInstructions').textContent = resetStep === 'lookup' ? t('forgotEmailPrompt') : resetStep === 'email' ? t('resetEmailPrompt') : resetStep === 'code' ? t('emailCodeSent') : '';
            resetSubmit.textContent = t(resetStep === 'lookup' ? 'continue' : resetStep === 'email' ? 'sendEmailCode' : resetStep === 'code' ? 'continue' : 'resetPasswordTitle');
            document.querySelector('label[for="resetEmail"]').textContent = t(resetStep === 'lookup' ? 'recoveryEmail' : 'email');
            resetError.textContent = resetErrorKey === 'twoFactorRequired' ? Account.t('factorOrRecovery') : t(resetErrorKey) || '';
            document.querySelector('label[for="resetFactor"]').textContent = Account.t('factorOrRecovery');
        }
        submit.querySelector('[data-i18n]').textContent = t(busy ? 'working' : verifying ? 'continue' : creating ? 'createAccount' : 'signIn');
        submit.querySelector('.signin-spinner').hidden = !busy;
        modeButton.setAttribute('aria-pressed', String(creating));
        signinModeButton.setAttribute('aria-pressed', String(!creating));
        document.getElementById('modeGroup').setAttribute('aria-label', t('modeLabel'));
        toggle.setAttribute('aria-label', t(password.type === 'password' ? 'showPassword' : 'hidePassword'));
        if (statusKey) document.getElementById('statusMessage').textContent = statusKey === 'twoFactorRequired' ? Account.t('factorOrRecovery') : t(statusKey);
        document.querySelectorAll('.signin-error[data-error-key]').forEach(element => { element.textContent = t(element.dataset.errorKey); });
        document.getElementById('backLink').setAttribute('aria-label', t('back'));
        updateTheme();
    }
    function error(input, key) {
        const message = document.getElementById(`${input.id}Error`);
        input.classList.toggle('is-invalid', Boolean(key));
        input.setAttribute('aria-invalid', String(Boolean(key)));
        message.hidden = !key;
        if (key) { message.dataset.errorKey = key; message.textContent = t(key); }
        else { delete message.dataset.errorKey; message.textContent = ''; }
    }
    function validate(input) {
        let key = '';
        if (input === email) key = !email.value.trim() ? 'emailRequired' : email.validity.typeMismatch || email.value.length > 254 || /[^\x00-\x7f]/.test(email.value) ? 'emailInvalid' : '';
        if (input === password) key = !password.value ? 'passwordRequired' : creating && [...password.value].length < 12 ? 'passwordWeak' : '';
        if (input === confirmation && creating) key = confirmation.value !== password.value ? 'passwordMismatch' : '';
        if (input === displayName && creating) key = !displayName.value.replace(/[\u0000-\u001f\u007f]/g, '').trim() ? 'displayNameRequired' : '';
        error(input, key);
        return !key;
    }
    function message(key) {
        statusKey = key;
        document.getElementById('statusMessage').textContent = key === 'twoFactorRequired' ? Account.t('factorOrRecovery') : key ? t(key) : '';
        status.hidden = !key;
    }
    function showSession(account) {
        if (!account) {
            document.getElementById('confirmField').hidden = !creating;
            confirmation.disabled = !creating;
            confirmation.required = creating;
            password.autocomplete = creating ? 'new-password' : 'current-password';
            showProfileFields();
        }
        signinBody.hidden = Boolean(account);
        sessionPanel.hidden = !account;
        document.getElementById('accountEmail').textContent = account?.email || '';
        if (account) {
            password.value = '';
            confirmation.value = '';
            emailCode.value = '';
            password.type = 'password';
            toggle.setAttribute('aria-pressed', 'false');
            toggle.querySelector('.mu-icon').textContent = 'visibility';
        }
        message('');
        renderLanguage();
    }
    const KNOWN_ERRORS = ['invalidCredentials', 'passwordWeak', 'createFailed', 'tooManyAttempts', 'emailCodeRequired', 'emailCodeInvalid', 'emailCodeCooldown', 'emailDeliveryUnavailable', 'displayNameRequired', 'birthdayInvalid'];
    const errorKey = failure => (KNOWN_ERRORS.includes(failure?.code) ? failure.code : 'unavailable');
    function resetView(step, focus = true) {
        resetStep = step;
        resetForm.hidden = !step;
        form.hidden = Boolean(step);
        document.getElementById('modeGroup').hidden = Boolean(step);
        forgot.hidden = creating || Boolean(step);
        forgotEmail.hidden = forgot.hidden;
        for (const [field, input, stage] of [['resetEmailField', resetEmail, 'email'], ['resetCodeField', resetCode, 'code'],
            ['resetPasswordFields', resetPassword, 'password'], ['resetFactorField', resetFactor, 'factor']]) {
            document.getElementById(field).hidden = input.disabled = step !== stage && !(step === 'lookup' && stage === 'email');
        }
        resetConfirm.disabled = resetPassword.disabled;
        resetError.hidden = true;
        resetErrorKey = '';
        renderLanguage();
        if (focus) ({ email: resetEmail, lookup: resetEmail, code: resetCode, password: resetPassword }[step] || email).focus();
    }
    forgotEmail.addEventListener('click', () => {
        resetForm.reset();
        forgotEmailResult.hidden = true;
        resetView('lookup');
    });
    forgot.addEventListener('click', () => {
        resetForm.reset();
        resetProof = '';
        resetEmail.value = email.value;
        document.getElementById('resetSuccess').hidden = true;
        forgotEmailResult.hidden = true;
        resetView('email');
    });
    document.getElementById('cancelReset').addEventListener('click', () => {
        if (resetSubmit.disabled) return;
        resetForm.reset();
        resetProof = '';
        resetView('');
    });
    resetForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (resetSubmit.disabled || !resetStep) return;
        resetSubmit.disabled = true;
        resetError.hidden = true;
        try {
            if (resetStep === 'lookup') {
                await Account.requestForgotEmail(resetEmail.value.trim());
                resetForm.reset();
                resetView('');
                forgotEmailResult.hidden = false;
            } else if (resetStep === 'email') {
                await Account.requestPasswordReset(resetEmail.value.trim());
                resetView('code');
            } else if (resetStep === 'code') {
                resetProof = resetCode.value.trim();
                resetView('password');
            } else {
                if (resetPassword.value !== resetConfirm.value) throw Object.assign(new Error('passwordMismatch'), { code: 'passwordMismatch' });
                await Account.resetPassword(resetEmail.value.trim(), resetProof, resetPassword.value, resetFactor.value.trim());
                email.value = resetEmail.value;
                password.value = '';
                resetForm.reset();
                resetProof = '';
                resetView('');
                document.getElementById('resetSuccess').hidden = false;
                password.focus();
            }
        } catch (failure) {
            if (failure.code === 'twoFactorRequired') {
                resetFactor.disabled = false;
                document.getElementById('resetFactorField').hidden = false;
                resetFactor.focus();
            }
            resetErrorKey = ['passwordMismatch', 'twoFactorRequired'].includes(failure.code) ? failure.code : errorKey(failure);
            resetError.hidden = false;
            renderLanguage();
        } finally { resetSubmit.disabled = false; }
    });
    function finish(account) {
        if (continueTo || defaultDestination) { location.assign(continueTo || defaultDestination); return; }
        showSession(account);
        document.getElementById('continueLink').focus();
    }
    toggle.addEventListener('click', () => {
        const show = password.type === 'password';
        const start = password.selectionStart, end = password.selectionEnd;
        password.type = show ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(show));
        toggle.setAttribute('aria-label', t(show ? 'hidePassword' : 'showPassword'));
        toggle.querySelector('.mu-icon').textContent = show ? 'visibility_off' : 'visibility';
        password.focus({ preventScroll: true });
        if (start !== null) password.setSelectionRange(start, end);
    });
    [email, password, confirmation].forEach(input => {
        input.addEventListener('blur', () => { if (input.value || input.getAttribute('aria-invalid') === 'true') validate(input); });
        input.addEventListener('input', () => { if (input.getAttribute('aria-invalid') === 'true') validate(input); message(''); });
    });
    function updateVerificationFields() {
        document.getElementById('emailCodeField').hidden = !verifying;
        for (const input of [email, password, confirmation]) input.closest('.mu-field').hidden = verifying || (input === confirmation && !creating);
        document.getElementById('backToSignup').hidden = !verifying;
    }
    document.getElementById('backToSignup').addEventListener('click', () => {
        if (busy) return;
        verifying = false;
        message('');
        updateVerificationFields();
        renderLanguage();
        email.focus();
    });
    // Creating an account: typing a name (or "name@mun…") offers name@munetios.com, the address that comes with a mailbox.
    const emailSuggest = document.getElementById('emailSuggest');
    const emailSuggestText = document.getElementById('emailSuggestText');
    function munetiosSuggestion() {
        if (!creating) return '';
        const value = email.value.trim().toLowerCase();
        const [local, domain = null] = value.split('@');
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(local || '')) return '';
        if (domain === null || (domain !== 'munetios.com' && 'munetios.com'.startsWith(domain))) return `${local}@munetios.com`;
        return '';
    }
    function updateEmailSuggestion() {
        const emailSuggest = document.getElementById('emailSuggest'), emailSuggestText = document.getElementById('emailSuggestText');
        if (!emailSuggest) return;
        const suggestion = munetiosSuggestion();
        emailSuggest.hidden = !suggestion;
        if (suggestion) emailSuggestText.textContent = t('emailSuggestMunetios').replace('{address}', suggestion);
        emailSuggest.dataset.address = suggestion;
    }
    emailSuggest.addEventListener('click', () => {
        if (!emailSuggest.dataset.address) return;
        email.value = emailSuggest.dataset.address;
        email.dispatchEvent(new Event('input', { bubbles: true }));
        email.focus();
    });
    // Accepting is always deliberate (click, or Enter/Space on the suggestion): typing and Tab never fill in a half-typed name.
    // ArrowDown moves focus to the suggestion; ArrowUp or Escape there goes back to the email field.
    email.addEventListener('keydown', event => {
        if (!emailSuggest.hidden && event.key === 'ArrowDown') { event.preventDefault(); emailSuggest.focus(); }
    });
    emailSuggest.addEventListener('keydown', event => {
        if (event.key === 'ArrowUp' || event.key === 'Escape') { event.preventDefault(); email.focus(); }
    });
    email.addEventListener('input', () => {
        emailCode.value = '';
        emailCodeNotice.hidden = true;
        updateVerificationFields();
        updateEmailSuggestion();
    });
    emailCodeButton.addEventListener('click', async () => {
        if (!creating || isInternal() || !validate(email)) { email.focus(); return; }
        const address = email.value.trim();
        emailCodeButton.disabled = true;
        try {
            await Account.requestEmailCode(address);
            if (creating && email.value.trim() === address) {
                message('');
                emailCodeNotice.hidden = false;
                emailCode.focus();
            }
        } catch (failure) { if (email.value.trim() === address) message(errorKey(failure)); }
        finally { emailCodeButton.disabled = false; }
    });
    const setMode = next => {
        if (busy || creating === next) return;
        creating = next;
        verifying = false;
        forgot.hidden = creating;
        forgotEmail.hidden = creating;
        forgotEmailResult.hidden = true;
        document.getElementById("authCodeField").hidden = true;
        document.getElementById("authCode").value = "";
        document.getElementById('confirmField').hidden = !creating;
        confirmation.disabled = !creating;
        confirmation.required = creating;
        confirmation.value = '';
        showProfileFields();
        updateVerificationFields();
        updateEmailSuggestion();
        password.autocomplete = creating ? 'new-password' : 'current-password';
        [email, password, confirmation, displayName].forEach(input => error(input, ''));
        message('');
        renderLanguage();
    };
    displayName.addEventListener('blur', () => { if (creating && displayName.value) validate(displayName); });
    birthdayButton.addEventListener('click', () => {
        if (!window.MunetiosUI?.pickDate) return;
        const today = new Date();
        const max = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        window.MunetiosUI.pickDate({
            anchor: birthdayButton,
            value: birthday || `${today.getFullYear() - 25}-01-01`,
            min: '1900-01-01',
            max,
            locale,
            allowClear: Boolean(birthday),
            labels: { previous: t('pickerPrevious'), next: t('pickerNext'), today: t('pickerToday'), clear: t('birthdayClear'), date: t('birthday'), chooseYear: t('pickerChooseYear'), chooseMonth: t('pickerChooseMonth') },
            onPick: (iso) => { birthday = iso && iso <= max ? iso : ''; paintBirthday(); birthdayButton.focus(); },
        });
    });
    birthdayClear.addEventListener('click', () => { birthday = ''; paintBirthday(); birthdayButton.focus(); });
    modeButton.addEventListener('click', () => setMode(true));
    signinModeButton.addEventListener('click', () => setMode(false));
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        const fields = googleFactor ? [] : creating ? [email, password, confirmation, displayName] : [email, password];
        const valid = fields.map(validate);
        if (valid.includes(false)) { fields[valid.indexOf(false)].focus(); return; }
        if (verifying && !/^\d{6}$/.test(emailCode.value.trim())) { message('emailCodeRequired'); emailCode.focus(); return; }
        busy = true;
        submit.disabled = modeButton.disabled = signinModeButton.disabled = true;
        email.readOnly = true;
        form.setAttribute('aria-busy', 'true');
        message(''); renderLanguage();
        try {
            if (googleFactor) {
                const { continueTo } = await Account.security.googleFactor(document.getElementById('authCode').value.trim());
                location.assign(continueTo);
                return;
            }
            if (creating && !isInternal() && !verifying) {
                try { await Account.requestEmailCode(email.value.trim()); }
                catch (failure) { if (failure.code !== 'emailCodeCooldown') throw failure; }
                verifying = true;
                emailCodeNotice.hidden = false;
                updateVerificationFields();
                emailCode.focus();
                return;
            }
            // The password stays in this browser: Account derives the login secret and the encryption key from it.
            const details = {
                email: email.value.trim(), password: password.value, code: document.getElementById('authCode').value.trim(),
                emailCode: isInternal() ? undefined : emailCode.value.trim(), add: adding,
                ...(creating ? { displayName: displayName.value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim(), birthday: birthday || null } : {}),
            };
            const account = creating ? await Account.signUp(details) : await Account.signIn(details);
            if (!account?.email) throw new Error('unavailable');
            finish(account);
        } catch (failure) {
            if (failure.code === 'twoFactorRequired') { document.getElementById('authCodeField').hidden = false; document.getElementById('authCode').focus(); message('twoFactorRequired'); }
            else { message(errorKey(failure)); status.focus(); }
        }
        finally { busy = false; email.readOnly = false; submit.disabled = modeButton.disabled = signinModeButton.disabled = false; form.removeAttribute('aria-busy'); renderLanguage(); }
    });
    // Sign out asks first, then shows "Signing out of this account. Please wait…". If the server fails or is
    // too slow, the session is marked invalid on this device (still shown as signed in elsewhere), so this
    // page shows the sign-in form to sign in again.
    const signOutText = key => t(key) || Account.t(key);
    const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    async function signOutNow(dialog) {
        const button = document.getElementById('signoutButton');
        const sessionError = document.getElementById('sessionError');
        button.disabled = true;
        sessionError.hidden = true;
        try { await Account.signOut(); creating = false; showSession(Account.state.account); if (!Account.state.account) email.focus(); }
        catch (error) {
            if (error?.code === 'signOutPending') { creating = false; showSession(null); if (Account.state.account) email.value = Account.state.account.email || ''; password.focus(); }
            else { sessionError.dataset.errorKey = 'unavailable'; sessionError.textContent = t('unavailable'); sessionError.hidden = false; }
        }
        finally {
            button.disabled = false;
            if (dialog) { if (!dialog.hidden) window.MunetiosUI.closeModal(dialog); dialog.remove(); }
        }
    }
    document.getElementById('signoutButton').addEventListener('click', () => {
        if (!window.MunetiosUI?.openModal) { if (window.confirm(signOutText('signOutConfirmTitle'))) signOutNow(null); return; }
        document.getElementById('signinSignOutModal')?.remove();
        const modal = document.createElement('div');
        modal.className = 'mu-modal';
        modal.id = 'signinSignOutModal';
        modal.hidden = true;
        modal.innerHTML = `<section class="mu-dialog" role="dialog" aria-modal="true" aria-labelledby="signinSignOutTitle" aria-describedby="signinSignOutBody">
            <div class="mu-dialog-header"><div class="mu-dialog-heading"><span class="mu-icon-circle"><span class="mu-icon" aria-hidden="true">logout</span></span><h2 id="signinSignOutTitle">${escapeText(signOutText('signOutConfirmTitle'))}</h2></div></div>
            <p class="mu-muted" id="signinSignOutBody">${escapeText(signOutText('signOutConfirmBody'))}</p>
            <div class="signin-signing-out" role="status" aria-live="polite" hidden>
                <div class="spinner-container is-sm" aria-hidden="true"><svg class="google-spinner" viewBox="0 0 50 50" focusable="false"><circle class="spinner-circle" cx="25" cy="25" r="20" fill="none" stroke-width="5"></circle></svg></div>
                <span>${escapeText(signOutText('signingOut'))}</span>
            </div>
            <div class="mu-dialog-actions">
                <button type="button" class="mu-btn" data-mu-close>${escapeText(signOutText('cancel'))}</button>
                <button type="button" class="mu-btn mu-btn-danger" data-signout-confirm><span class="mu-icon" aria-hidden="true">logout</span><span>${escapeText(signOutText('signOut'))}</span></button>
            </div>
        </section>`;
        document.body.append(modal);
        const shown = window.MunetiosUI.openModal(modal.id) || modal;
        shown.querySelector('[data-signout-confirm]').addEventListener('click', () => {
            shown.querySelector('.signin-signing-out').hidden = false;
            shown.querySelector('#signinSignOutBody').hidden = true;
            shown.querySelectorAll('.mu-dialog-actions button').forEach(button => { button.disabled = true; });
            signOutNow(shown);
        }, { once: true });
    });
    language.value = locale = resolveLocale(get('munetiosLanguage') || navigator.language);
    language.addEventListener('change', () => { locale = language.value; set('munetiosLanguage', locale); renderLanguage(); });
    themeButton.addEventListener('click', () => window.MunetiosUI.theme.set(root.dataset.muTheme === 'light' ? 'dark' : 'light'));
    document.addEventListener('mu-theme', updateTheme);
    const savedTheme = get('munetiosTheme');
    if (savedTheme) root.dataset.muTheme = savedTheme === 'light-mode' ? 'light' : 'dark';
    try {
        const source = new URL(document.referrer);
        if (source.origin === location.origin && source.pathname.startsWith('/omniwrite')) {
            document.getElementById('backLink').href = '/omniwrite/';
            document.getElementById('continueLink').href = '/omniwrite/';
            document.getElementById('backBrand').textContent = 'OmniWrite';
            document.getElementById('backLogo').hidden = true;
        }
    } catch {}
    if (continueTo) {
        document.getElementById('backLink').href = continueTo;
        document.getElementById('continueLink').href = continueTo;
        if (/^\/apps\/supervidplayer(?:[/?#]|$)/.test(continueTo)) {
            document.getElementById('backBrand').textContent = 'SuperVidPlayer';
            document.getElementById('backLogo').src = '/apps/supervidplayer/assets/SuperVidPlayer.png';
        } else if (/^\/webfilter(?:[/?#]|$)/.test(continueTo)) {
            document.getElementById('backBrand').textContent = 'Munetios WebFilter';
            document.getElementById('backLogo').src = '/webfilter/icons/icon-32.png';
        } else if (/^\/mail(?:[/?#]|$)/.test(continueTo)) {
            document.getElementById('backBrand').textContent = 'Munetios Mail';
            document.getElementById('backLogo').hidden = true;
        } else if (continueTo.startsWith('/omniwrite') || continueTo.startsWith('/account')) {
            document.getElementById('backBrand').textContent = continueTo.startsWith('/omniwrite') ? 'OmniWrite' : 'Munetios';
            document.getElementById('backLogo').hidden = true;
        }
    }
    if (omniWriteHost) {
        document.getElementById('backBrand').textContent = 'OmniWrite';
        const logo = document.getElementById('backLogo');
        logo.src = '/omniwrite/favicon-32x32.png';
        logo.hidden = false;
        document.querySelector('link[rel="icon"]').href = logo.src;
        document.getElementById('signinSearchBadge').hidden = true;
        document.getElementById('signinProducts').setAttribute('aria-label', 'OmniWrite');
    }
    renderLanguage();
    language.dispatchEvent(new Event('change'));
    submit.disabled = false;
    function openResetLink() {
        const resetLink = new URLSearchParams(location.hash.slice(1));
        if (!/^[a-f0-9]{64}$/.test(resetLink.get('reset') || '') || !resetLink.get('email')) return false;
        resetForm.reset();
        resetProof = resetLink.get('reset');
        resetEmail.value = resetLink.get('email');
        history.replaceState(null, '', location.pathname + location.search);
        resetView('password');
        showSession(null);
        return true;
    }
    window.addEventListener('hashchange', openResetLink);
    const resetLinkOpen = openResetLink();
    if (!resetLinkOpen && params.get('forgot') === '1') resetView('email');
    if (!resetStep && (omniWriteHost || /^\/omniwrite(?:[/?#]|$)/.test(continueTo))) {
        window.OmniLocalSignIn.checkSignIn(omniWriteHost ? '/' : '/omniwrite/');
    }
    if (defaultDestination && !continueTo) document.getElementById('continueLink').href = defaultDestination;
    const googleParams = new URLSearchParams({ continue: continueTo || defaultDestination || '/', add: adding ? '1' : '0' });
    google.href = '/api/auth/google/start?' + googleParams;
    fetch('/api/auth/google/config', { cache: 'no-store' }).then(response => response.json()).then(data => {
        googleEnabled = Boolean(data.enabled);
        renderLanguage();
    }).catch(() => {});
    if (params.get('google') === 'failed') message('googleSignInFailed');
    if (googleFactor) {
        for (const field of [email, password]) field.closest('.mu-field').hidden = true;
        for (const element of [document.getElementById('modeGroup'), forgot, forgotEmail]) element.hidden = true;
        document.getElementById('authCodeField').hidden = false;
        document.getElementById('authCode').focus();
    }
    // Already signed in: show the session panel, unless an additional account is being added.
    // An invalid session still keeps the account shown as signed in elsewhere: here it means signing in again.
    Account.refresh().then(state => {
        if (state.account && params.get('forgot') === '1' && resetStep === 'email' && !resetEmail.value) resetEmail.value = state.account.email;
        if (state.account && state.revocation && !adding && !busy && !email.value) email.value = state.account.email || '';
        if (state.account && !state.revocation && !googleFactor && !adding && !busy && !resetStep && !email.value && !password.value) showSession(state.account);
    }).catch(() => {});
})();
