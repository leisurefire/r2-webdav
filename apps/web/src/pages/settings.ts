import { API_BASE, aiModelForAction, api, availableAiModels, saveAiModelForAction, saveAvailableAiModels } from '../api/client';
import { errorMessage, html, refreshIcons, shell, toast, render } from '../shell';
import { locale, setLocale, t, type Locale, type MessageKey } from '../i18n';

export function renderSettings(): void {
	const davOrigin = API_BASE || location.origin;
	shell(
		'settings',
		t('settings'),
		`<div class="settings">
		<section class="settings-section"><h2 class="settings-section-heading"><i data-lucide="cloud"></i><span>${t('settingsConnection')}</span></h2>
			<div class="field"><label>${t('webdavUrl')}</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/"><button class="button icon-button" data-copy="${html(davOrigin)}/" title="${t('copy')} ${t('webdavUrl')}" aria-label="${t('copy')} ${t('webdavUrl')}"><i data-lucide="copy"></i></button></div></div>
			<div class="field"><label>${t('caldavUrl')}</label><div class="input-row"><input class="input" readonly value="${html(davOrigin)}/caldav/"><button class="button icon-button" data-copy="${html(davOrigin)}/caldav/" title="${t('copy')} ${t('caldavUrl')}" aria-label="${t('copy')} ${t('caldavUrl')}"><i data-lucide="copy"></i></button></div></div>
		</section>
		<section class="settings-section"><h2 class="settings-section-heading"><i data-lucide="languages"></i><span>${t('settingsLanguage')}</span></h2>
			<div class="field"><label for="language-select">${t('settingsLanguage')}</label><select class="input" id="language-select"><option value="en" ${locale === 'en' ? 'selected' : ''}>${t('english')}</option><option value="zh" ${locale === 'zh' ? 'selected' : ''}>${t('chinese')}</option></select><p class="muted">${t('settingsLanguageHint')}</p></div>
		</section>
		<section class="settings-section"><h2 class="settings-section-heading"><i data-lucide="sparkles"></i><span>${t('settingsAi')}</span></h2>
			${(['generate', 'summarize', 'polish', 'rewrite'] as const)
				.map(
					(action) =>
						`<div class="field"><label for="ai-model-${action}">${t(`aiAction${action[0].toUpperCase()}${action.slice(1)}` as MessageKey)}</label><select class="input" id="ai-model-${action}" data-ai-model-action="${action}">${availableAiModels()
							.map(
								(model) =>
									`<option value="${html(model)}" ${model === aiModelForAction(action) ? 'selected' : ''}>${html(model)}</option>`,
							)
							.join('')}</select></div>`,
				)
				.join('')}
			<div class="field"><button class="button" id="ai-pull-models"><i data-lucide="refresh-cw"></i><span>${t('aiPullModels')}</span></button><p class="muted">${t('settingsAiHint')}</p></div>
		</section>
	</div>`,
	);
	document.querySelector<HTMLSelectElement>('#language-select')?.addEventListener('change', (event) => {
		setLocale((event.target as HTMLSelectElement).value as Locale);
		localStorage.setItem('r2_locale', locale);
		document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
		void render();
	});
	document.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) =>
		button.addEventListener('click', async () => {
			await navigator.clipboard.writeText(button.dataset.copy!);
			toast(t('copied'));
		}),
	);
	document.querySelectorAll<HTMLSelectElement>('[data-ai-model-action]').forEach((select) =>
		select.addEventListener('change', () => {
			saveAiModelForAction(
				select.dataset.aiModelAction as 'generate' | 'summarize' | 'polish' | 'rewrite',
				select.value,
			);
		}),
	);
	document.querySelector<HTMLButtonElement>('#ai-pull-models')?.addEventListener('click', async (event) => {
		const button = event.currentTarget as HTMLButtonElement;
		const label = button.querySelector('span');
		button.disabled = true;
		if (label) label.textContent = t('aiPullModelsBusy');
		try {
			const models = await api.aiModels();
			if (!models.length) throw new Error(locale === 'zh' ? '服务未返回可用模型' : 'No supported models returned');
			saveAvailableAiModels(models);
			document.querySelectorAll<HTMLSelectElement>('[data-ai-model-action]').forEach((select) => {
				const current = select.value;
				select.replaceChildren(...models.map((model) => new Option(model, model, false, model === current)));
			});
			toast(t('aiPullModelsDone'));
		} catch (error) {
			toast(errorMessage(error));
		} finally {
			button.disabled = false;
			if (label) label.textContent = t('aiPullModels');
		}
	});
	refreshIcons();
}
