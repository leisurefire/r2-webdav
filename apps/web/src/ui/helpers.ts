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

export interface WorkspaceSidebarOptions {
	label: string;
	ariaLabel?: string;
	tools?: string;
	body: string;
	treeClass?: string;
	treeAttributes?: string;
	footer?: string;
}

export function workspaceSidebarMarkup(options: WorkspaceSidebarOptions): string {
	return `<aside class="notes-folders workspace-context-panel" aria-label="${html(options.ariaLabel ?? options.label)}">
		<div class="notes-folders-head sidebar-context-head"><strong>${html(options.label)}</strong>${options.tools ?? ''}</div>
		<div class="notes-tree ${options.treeClass ?? ''}" ${options.treeAttributes ?? ''}>${options.body}</div>
		${options.footer ?? ''}
	</aside>`;
}

export function treeLeadingMarkup(icon: string, expanded: boolean, loading = false): string {
	if (loading)
		return '<span class="note-tree-leading" aria-hidden="true"><i class="note-tree-loader" data-lucide="loader-circle"></i></span>';
	return `<span class="note-tree-leading" aria-hidden="true"><i class="tree-folder-icon" data-lucide="${html(icon)}"></i><i class="tree-caret-icon" data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}"></i></span>`;
}

/** Animate a tree branch closed before the caller re-renders and removes it. */
export function collapseTreeBranch(host: Element | null | undefined, branchSelector: string, done: () => void): void {
	const branch = host?.querySelector<HTMLElement>(`:scope > ${branchSelector}`);
	if (!branch || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		done();
		return;
	}
	branch.style.setProperty('--tree-branch-height', `${Math.max(branch.scrollHeight, 1)}px`);
	branch.classList.add('is-collapsing');
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		branch.removeEventListener('animationend', onEnd);
		done();
	};
	const onEnd = (event: AnimationEvent) => {
		if (event.target === branch) finish();
	};
	branch.addEventListener('animationend', onEnd);
	window.setTimeout(finish, 220);
}

/** Mark a freshly mounted tree branch so CSS can run the open animation once. */
export function expandTreeBranch(host: Element | null | undefined, branchSelector: string): void {
	const branch = host?.querySelector<HTMLElement>(`:scope > ${branchSelector}`);
	if (!branch || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	branch.classList.add('is-expanding');
	const clear = (event?: AnimationEvent) => {
		if (event && event.target !== branch) return;
		branch.classList.remove('is-expanding');
		branch.removeEventListener('animationend', clear);
	};
	branch.addEventListener('animationend', clear);
	window.setTimeout(() => clear(), 220);
}

/** Bring a path target into view and reuse the workspace's temporary accent highlight. */
export function showTreePathHighlight(target: HTMLElement | null | undefined): void {
	if (!target) return;
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	target.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
	const className = reducedMotion ? 'tree-path-highlight-reduced' : 'tree-path-highlight';
	target.classList.remove('tree-path-highlight', 'tree-path-highlight-reduced');
	void target.offsetWidth;
	target.classList.add(className);
	const clear = () => target.classList.remove(className);
	if (reducedMotion) window.setTimeout(clear, 700);
	else {
		const onEnd = (event: AnimationEvent) => {
			if (event.target !== target) return;
			target.removeEventListener('animationend', onEnd);
			clear();
		};
		target.addEventListener('animationend', onEnd);
		window.setTimeout(() => {
			target.removeEventListener('animationend', onEnd);
			clear();
		}, 1300);
	}
}
