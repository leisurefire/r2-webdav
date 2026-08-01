import { describe, expect, it } from 'vitest';
import {
	actionMenuMarkup,
	emptyStateMarkup,
	errorBannerMarkup,
	html,
	iconButtonMarkup,
	markupAttributes,
	menuItemMarkup,
} from './markup';

describe('shared UI markup', () => {
	it('escapes text and attribute values', () => {
		expect(html(`<button title="'">&`)).toBe('&lt;button title=&quot;&#039;&quot;&gt;&amp;');
		expect(markupAttributes({ title: 'A&B', disabled: true, hidden: false, 'aria-pressed': false, empty: null })).toBe(
			'title="A&amp;B" disabled aria-pressed="false"',
		);
	});

	it('rejects invalid attribute names', () => {
		expect(markupAttributes({ 'data-id': '1', 'bad name': '2', '><script': '3' })).toBe('data-id="1"');
	});

	it('builds an accessible icon command', () => {
		const markup = iconButtonMarkup({
			icon: 'refresh-cw',
			label: 'Refresh & sync',
			attributes: { 'data-refresh': true, 'aria-pressed': false },
		});
		expect(markup).toContain('type="button"');
		expect(markup).toContain('title="Refresh &amp; sync"');
		expect(markup).toContain('aria-label="Refresh &amp; sync"');
		expect(markup).toContain('data-refresh');
		expect(markup).not.toContain('data-refresh="true"');
		expect(markup).toContain('aria-pressed="false"');
	});

	it('builds action menus with one trigger contract', () => {
		const items = menuItemMarkup({
			label: 'Delete',
			icon: 'trash-2',
			className: 'danger',
			attributes: { 'data-delete': 'note-1' },
		});
		const markup = actionMenuMarkup({ label: 'More', items, className: 'note-actions' });
		expect(markup).toContain('class="action-menu note-actions"');
		expect(markup).toContain('data-menu-toggle');
		expect(markup).not.toContain('data-menu-toggle="true"');
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain('role="menuitem"');
		expect(markup).toContain('data-delete="note-1"');
	});

	it('uses the same escaped feedback structure everywhere', () => {
		expect(emptyStateMarkup('<Empty>', { icon: 'folder', compact: true })).toBe(
			'<div class="empty-state empty-state--compact"><i data-lucide="folder" aria-hidden="true"></i><span class="empty-state-message">&lt;Empty&gt;</span></div>',
		);
		expect(errorBannerMarkup('<Failed>')).toBe('<div class="error-banner" role="alert">&lt;Failed&gt;</div>');
	});
});
