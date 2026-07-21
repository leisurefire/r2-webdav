import type { DeviceSession } from '@r2-webdav/shared-types';
import {
	API_BASE,
	aiModelForAction,
	api,
	availableAiModels,
	saveAiModelForAction,
	saveAvailableAiModels,
	type AiAction,
} from '../api/client';
import { confirmAction, errorMessage, html, loadingMarkup, navigate, refreshIcons, render, toast } from '../shell';
import { locale, setLocale, t, type Locale, type MessageKey } from '../i18n';

type SettingsTab = 'connection' | 'language' | 'ai' | 'devices';

const tabs: Array<{ id: SettingsTab; icon: string; zh: string; en: string }> = [
	{ id: 'connection', icon: 'cloud', zh: '连接', en: 'Connection' },
	{ id: 'language', icon: 'languages', zh: '语言', en: 'Language' },
	{ id: 'ai', icon: 'sparkles', zh: 'AI 助手', en: 'AI assistant' },
	{ id: 'devices', icon: 'laptop', zh: '设备管理', en: 'Devices' },
];

const aiActions: Array<{ id: AiAction; key: MessageKey | null; zh: string; en: string }> = [
	{ id: 'chat', key: null, zh: '便签问答', en: 'Note Q&A' },
	{ id: 'generate', key: 'aiActionGenerate', zh: '写作', en: 'Writing' },
	{ id: 'summarize', key: 'aiActionSummarize', zh: '总结', en: 'Summarize' },
	{ id: 'polish', key: 'aiActionPolish', zh: '润色', en: 'Polish' },
	{ id: 'rewrite', key: 'aiActionRewrite', zh: '修改', en: 'Edit with AI' },
];

function label(zh: string, en: string): string {
	return locale === 'zh' ? zh : en;
}

function deviceMarkup(device: DeviceSession): string {
	return `<article class="settings-device-card">
		<div class="device-icon"><i data-lucide="${device.type === 'mobile' ? 'smartphone' : 'laptop'}"></i></div>
		<div class="device-info"><div><h3>${html(device.name)}</h3>${device.current ? `<span class="current-badge"><span class="status-dot"></span>${t('currentDevice')}</span>` : ''}</div><p>${html(device.browser)} · ${html(device.platform)}${device.ip ? ` · ${html(device.ip)}` : ''}</p><dl><div><dt>${t('lastActive')}</dt><dd>${new Date(device.lastSeenAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</dd></div><div><dt>${t('expires')}</dt><dd>${new Date(device.expiresAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</dd></div></dl></div>
		<button type="button" class="button ${device.current ? 'danger' : ''}" data-revoke="${html(device.id)}">${t('revoke')}</button>
	</article>`;
}

export async function openSettingsModal(initialTab: SettingsTab = 'connection'): Promise<void> {
	document.querySelector<HTMLDialogElement>('#settings-dialog')?.remove();
	const davOrigin = API_BASE || location.origin;
	const models = availableAiModels();
	const dialog = document.createElement('dialog');
	dialog.id = 'settings-dialog';
	dialog.className = 'settings-dialog';
	dialog.innerHTML = `<div class="settings-modal-shell">
		<header class="settings-modal-head"><div><h2>${t('settings')}</h2><p>${t('settingsDesc')}</p></div><button type="button" class="row-action" data-settings-close aria-label="${label('关闭', 'Close')}" title="${label('关闭', 'Close')}"><i data-lucide="x"></i></button></header>
		<div class="settings-modal-body">
			<nav class="settings-tabs" aria-label="${t('settings')}">${tabs.map((tab) => `<button type="button" data-settings-tab="${tab.id}" class="${tab.id === initialTab ? 'active' : ''}"><i data-lucide="${tab.icon}"></i><span>${label(tab.zh, tab.en)}</span></button>`).join('')}</nav>
			<div class="settings-panels">
				<section data-settings-panel="connection"><h3>${t('settingsConnection')}</h3><p class="settings-panel-hint">${label('用于第三方客户端连接 TrueSpace。', 'Use these endpoints to connect third-party clients.')}</p>
					<div class="field"><label>${t('webdavUrl')}</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/"><button class="button icon-button" data-copy="${html(davOrigin)}/" title="${t('copy')} ${t('webdavUrl')}" aria-label="${t('copy')} ${t('webdavUrl')}"><i data-lucide="copy"></i></button></div></div>
					<div class="field"><label>${t('caldavUrl')}</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/caldav/"><button class="button icon-button" data-copy="${html(davOrigin)}/caldav/" title="${t('copy')} ${t('caldavUrl')}" aria-label="${t('copy')} ${t('caldavUrl')}"><i data-lucide="copy"></i></button></div></div>
				</section>
				<section data-settings-panel="language" hidden><h3>${t('settingsLanguage')}</h3><p class="settings-panel-hint">${t('settingsLanguageHint')}</p><div class="field"><label for="language-select">${t('settingsLanguage')}</label><select class="input" id="language-select"><option value="en" ${locale === 'en' ? 'selected' : ''}>${t('english')}</option><option value="zh" ${locale === 'zh' ? 'selected' : ''}>${t('chinese')}</option></select></div></section>
				<section data-settings-panel="ai" hidden><h3>${t('settingsAi')}</h3><p class="settings-panel-hint">${label('可以从远端拉取模型，也可以直接输入任意模型 ID。', 'Pull models from the provider or enter any model ID manually.')}</p>
					<datalist id="ai-model-options">${models.map((model) => `<option value="${html(model)}"></option>`).join('')}</datalist>
					<div class="settings-ai-grid">${aiActions.map((action) => `<div class="field"><label for="ai-model-${action.id}">${action.key ? t(action.key) : label(action.zh, action.en)}</label><input class="input" id="ai-model-${action.id}" list="ai-model-options" value="${html(aiModelForAction(action.id))}" data-ai-model-action="${action.id}" autocomplete="off" spellcheck="false"></div>`).join('')}</div>
					<div class="settings-inline-action"><button type="button" class="button" id="ai-pull-models"><i data-lucide="refresh-cw"></i><span>${t('aiPullModels')}</span></button><span class="muted">${t('settingsAiHint')}</span></div>
				</section>
				<section data-settings-panel="devices" hidden><h3>${label('设备管理', 'Devices')}</h3><p class="settings-panel-hint">${t('devicesDesc')}</p><div class="settings-device-list" data-settings-devices>${loadingMarkup(true)}</div></section>
			</div>
		</div>
	</div>`;
	document.body.append(dialog);
	dialog.showModal();
	refreshIcons();
	let activeTab = initialTab;
	let devicesLoaded = false;
	const close = () => dialog.close();
	const loadDevices = async (force = false) => {
		if (devicesLoaded && !force) return;
		const host = dialog.querySelector<HTMLElement>('[data-settings-devices]');
		if (!host) return;
		host.innerHTML = loadingMarkup(true);
		try {
			const devices = await api.devices();
			devicesLoaded = true;
			host.innerHTML =
				devices.map(deviceMarkup).join('') || `<p class="muted">${label('没有已登录设备', 'No signed-in devices')}</p>`;
			refreshIcons();
			host.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((button) => {
				button.addEventListener('click', async () => {
					const device = devices.find((item) => item.id === button.dataset.revoke);
					if (!(await confirmAction(`${t('revoke')}?`, device?.name ?? '', t('revoke')))) return;
					try {
						const result = await api.deleteDevice(button.dataset.revoke!);
						if (result.current) {
							localStorage.removeItem('r2_session_token');
							close();
							navigate('/login');
						} else await loadDevices(true);
					} catch (error) {
						toast(errorMessage(error));
					}
				});
			});
		} catch (error) {
			host.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
		}
	};
	const activate = (tab: SettingsTab) => {
		activeTab = tab;
		dialog
			.querySelectorAll<HTMLElement>('[data-settings-tab]')
			.forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === tab));
		dialog
			.querySelectorAll<HTMLElement>('[data-settings-panel]')
			.forEach((panel) => (panel.hidden = panel.dataset.settingsPanel !== tab));
		if (tab === 'devices') void loadDevices();
	};
	dialog
		.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')
		.forEach((button) => button.addEventListener('click', () => activate(button.dataset.settingsTab as SettingsTab)));
	dialog.querySelector('[data-settings-close]')?.addEventListener('click', close);
	dialog.addEventListener('cancel', (event) => {
		event.preventDefault();
		close();
	});
	dialog.addEventListener('click', (event) => {
		if (event.target === dialog) close();
	});
	dialog.addEventListener('close', () => dialog.remove());
	dialog.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) =>
		button.addEventListener('click', async () => {
			await navigator.clipboard.writeText(button.dataset.copy!);
			toast(t('copied'));
		}),
	);
	dialog.querySelector<HTMLSelectElement>('#language-select')?.addEventListener('change', (event) => {
		setLocale((event.target as HTMLSelectElement).value as Locale);
		localStorage.setItem('r2_locale', locale);
		document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
		close();
		void render().then(() => openSettingsModal('language'));
	});
	dialog.querySelectorAll<HTMLInputElement>('[data-ai-model-action]').forEach((input) => {
		const save = () => saveAiModelForAction(input.dataset.aiModelAction as AiAction, input.value);
		input.addEventListener('change', save);
		input.addEventListener('blur', save);
	});
	dialog.querySelector<HTMLButtonElement>('#ai-pull-models')?.addEventListener('click', async (event) => {
		const button = event.currentTarget as HTMLButtonElement;
		const text = button.querySelector('span');
		button.disabled = true;
		if (text) text.textContent = t('aiPullModelsBusy');
		try {
			const remoteModels = await api.aiModels();
			if (!remoteModels.length) throw new Error(label('服务未返回可用模型', 'No models returned by the provider'));
			saveAvailableAiModels(remoteModels);
			const datalist = dialog.querySelector<HTMLDataListElement>('#ai-model-options');
			datalist?.replaceChildren(...remoteModels.map((model) => new Option('', model)));
			toast(t('aiPullModelsDone'));
		} catch (error) {
			toast(errorMessage(error));
		} finally {
			button.disabled = false;
			if (text) text.textContent = t('aiPullModels');
		}
	});
	activate(activeTab);
}
