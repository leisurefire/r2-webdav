import type { NoteFolder } from '@r2-webdav/shared-types';
import { html } from '../shell';
import { buildNoteFolderTree, flattenNoteFolderTree, noteFolderPath } from '../notes/folderTree';
import { locale } from '../i18n';
import { enhanceSelect } from './dropdown';
import { openTextInputDialog } from './dialogs';

export function openTextDialog(title: string, label: string, initial = ''): Promise<string | null> {
	return openTextInputDialog(
		title,
		label,
		initial,
		locale === 'zh' ? '保存' : 'Save',
		locale === 'zh' ? '取消' : 'Cancel',
	);
}

export function openFolderDialog(
	title: string,
	folders: NoteFolder[],
	currentId: string | null,
	excluded = new Set<string>(),
): Promise<string | null | undefined> {
	return new Promise((resolve) => {
		const rootLabel = locale === 'zh' ? '根目录' : 'Root';
		const options = [
			`<option value="" ${currentId === null ? 'selected' : ''}>${rootLabel}</option>`,
			...flattenNoteFolderTree(buildNoteFolderTree(folders))
				.filter(({ folder }) => !excluded.has(folder.id))
				.map(({ folder }) => {
					const label = noteFolderPath(folders, folder.id)
						.map((item) => item.name)
						.join(' / ');
					return `<option value="${html(folder.id)}" ${folder.id === currentId ? 'selected' : ''}>${html(label)}</option>`;
				}),
		].join('');
		const dialog = document.createElement('dialog');
		dialog.innerHTML = `<form method="dialog" class="dialog-body"><h2>${html(title)}</h2><div class="field"><label for="dialog-folder">${locale === 'zh' ? '目标目录' : 'Destination'}</label><select class="input" id="dialog-folder">${options}</select></div><div class="dialog-actions"><button class="button" value="cancel">${locale === 'zh' ? '取消' : 'Cancel'}</button><button class="button primary" value="confirm">${locale === 'zh' ? '移动' : 'Move'}</button></div></form>`;
		document.body.append(dialog);
		const select = dialog.querySelector<HTMLSelectElement>('#dialog-folder')!;
		const dropdown = enhanceSelect(select);
		dialog.addEventListener('close', () => {
			const value = select.value;
			const destination = dialog.returnValue === 'confirm' ? value || null : undefined;
			dialog.remove();
			resolve(destination);
		});
		dialog.showModal();
		dropdown.open();
	});
}

export function renderTreeNodes<T>(
	nodes: T[],
	childrenOf: (node: T) => T[],
	renderNode: (node: T, depth: number, children: string) => string,
	depth = 0,
): string {
	return nodes
		.map((node) => renderNode(node, depth, renderTreeNodes(childrenOf(node), childrenOf, renderNode, depth + 1)))
		.join('');
}
