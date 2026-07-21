import { api } from '../api/client';
import { app, errorMessage, html, refreshIcons, render } from '../shell';
import { locale, setLocale, t } from '../i18n';

export function renderLogin(): void {
	app.innerHTML = `<main class="login-page">
		<button class="login-language language-button" id="language-toggle"><i data-lucide="languages"></i><span>${t('language')}</span></button>
		<section class="login-intro" aria-hidden="true"><div class="intro-brand"><span class="brand-wordmark inverse">T</span><span>TrueSpace</span></div><div class="intro-copy"><span class="intro-index">01 / 04</span><h1>${t('hero')}</h1><p>${t('heroCopy')}</p></div><div class="storage-signal"><span>True</span><i data-lucide="cloud"></i></div></section>
		<section class="login-panel"><div class="login-box"><div class="login-brand"><span class="brand-wordmark">T</span><span>TrueSpace</span></div><div class="login-heading"><span class="page-kicker">${t('secureAccess')}</span><h2>${t('welcome')}</h2><p>${t('signIn')}</p></div>
		<form class="login-form" id="login-form"><div class="field"><label for="username">${t('username')}</label><input class="input" id="username" autocomplete="username" required></div><div class="field"><label for="password">${t('password')}</label><input class="input" id="password" type="password" autocomplete="current-password" required></div><div id="login-error"></div><button class="button primary" id="login-submit">${t('continue')}</button></form><p class="login-footnote">${locale === 'zh' ? '仅限授权用户访问。' : 'Authorized access only.'}</p></div></section>
	</main>`;
	refreshIcons();
	document.querySelector('#language-toggle')?.addEventListener('click', () => {
		setLocale(locale === 'en' ? 'zh' : 'en');
		localStorage.setItem('r2_locale', locale);
		document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
		renderLogin();
	});
	document.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', async (event) => {
		event.preventDefault();
		const submit = document.querySelector<HTMLButtonElement>('#login-submit')!;
		const error = document.querySelector<HTMLDivElement>('#login-error')!;
		submit.disabled = true;
		submit.textContent = t('signingIn');
		error.innerHTML = '';
		try {
			await api.login(
				document.querySelector<HTMLInputElement>('#username')!.value,
				document.querySelector<HTMLInputElement>('#password')!.value,
			);
			history.replaceState({}, '', '/files');
			await render();
		} catch (reason) {
			error.innerHTML = `<div class="error-banner">${html(errorMessage(reason))}</div>`;
			submit.disabled = false;
			submit.textContent = t('continue');
		}
	});
}
