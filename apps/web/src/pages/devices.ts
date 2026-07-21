import type { DeviceSession } from '@r2-webdav/shared-types';
import { api } from '../api/client';
import { confirmAction, errorMessage, html, navigate, refreshIcons, shell, toast } from '../shell';
import { locale, t } from '../i18n';

export async function renderDevices(): Promise<void> {
	shell('devices', t('devices'));
	const content = document.querySelector<HTMLDivElement>('#page-content')!;
	try {
		const devices = await api.devices();
		content.innerHTML = `<div class="device-list">${devices
			.map(
				(device) =>
					`<article class="device-card"><div class="device-icon"><i data-lucide="${device.type === 'mobile' ? 'smartphone' : 'laptop'}"></i></div><div class="device-info"><div><h2>${html(device.name)}</h2>${device.current ? `<span class="current-badge"><span class="status-dot"></span>${t('currentDevice')}</span>` : ''}</div><p>${html(device.browser)} · ${html(device.platform)}${device.ip ? ` · ${html(device.ip)}` : ''}</p><dl><div><dt>${t('lastActive')}</dt><dd>${new Date(device.lastSeenAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</dd></div><div><dt>${t('expires')}</dt><dd>${new Date(device.expiresAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en')}</dd></div></dl></div><button class="button ${device.current ? 'danger' : ''}" data-revoke="${device.id}">${t('revoke')}</button></article>`,
			)
			.join('')}</div>`;
		refreshIcons();
		content.querySelectorAll<HTMLElement>('[data-revoke]').forEach((button) =>
			button.addEventListener('click', async () => {
				if (
					!(await confirmAction(
						`${t('revoke')}?`,
						devices.find((item) => item.id === button.dataset.revoke)?.name ?? '',
						t('revoke'),
					))
				)
					return;
				try {
					const result = await api.deleteDevice(button.dataset.revoke!);
					if (result.current) {
						localStorage.removeItem('r2_session_token');
						navigate('/login');
					} else await renderDevices();
				} catch (error) {
					toast(errorMessage(error));
				}
			}),
		);
	} catch (error) {
		content.innerHTML = `<div class="error-banner">${html(errorMessage(error))}</div>`;
	}
}
