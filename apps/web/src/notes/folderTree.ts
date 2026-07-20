import type { NoteFolder } from '@r2-webdav/shared-types';

export interface NoteFolderNode {
	folder: NoteFolder;
	children: NoteFolderNode[];
}

export function noteFolderMap(folders: NoteFolder[]): Map<string, NoteFolder> {
	return new Map(folders.map((folder) => [folder.id, folder]));
}

export function noteFolderPath(folders: NoteFolder[], folderId: string | null | undefined): NoteFolder[] {
	if (!folderId) return [];
	const byId = noteFolderMap(folders);
	const path: NoteFolder[] = [];
	const visited = new Set<string>();
	let current = byId.get(folderId);
	while (current && !visited.has(current.id)) {
		visited.add(current.id);
		path.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path;
}

export function noteFolderDescendantIds(folders: NoteFolder[], folderId: string): Set<string> {
	const children = new Map<string, string[]>();
	for (const folder of folders) {
		if (!folder.parentId) continue;
		const siblings = children.get(folder.parentId) ?? [];
		siblings.push(folder.id);
		children.set(folder.parentId, siblings);
	}
	const descendants = new Set<string>();
	const pending = [...(children.get(folderId) ?? [])];
	while (pending.length) {
		const id = pending.pop()!;
		if (descendants.has(id)) continue;
		descendants.add(id);
		pending.push(...(children.get(id) ?? []));
	}
	return descendants;
}

export function canMoveNoteFolder(folders: NoteFolder[], folderId: string, parentId: string | null): boolean {
	if (parentId === folderId) return false;
	return !parentId || !noteFolderDescendantIds(folders, folderId).has(parentId);
}

export function buildNoteFolderTree(folders: NoteFolder[]): NoteFolderNode[] {
	const byId = noteFolderMap(folders);
	const nodes = new Map<string, NoteFolderNode>(
		folders.map((folder) => [folder.id, { folder, children: [] }] as [string, NoteFolderNode]),
	);
	const roots: NoteFolderNode[] = [];
	for (const folder of folders) {
		const node = nodes.get(folder.id)!;
		const parent = folder.parentId ? nodes.get(folder.parentId) : undefined;
		const hasValidParent =
			parent &&
			folder.parentId !== folder.id &&
			!noteFolderPath(folders, folder.parentId).some((ancestor) => ancestor.id === folder.id);
		if (hasValidParent && byId.has(folder.parentId!)) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

export function flattenNoteFolderTree(nodes: NoteFolderNode[]): NoteFolderNode[] {
	const flattened: NoteFolderNode[] = [];
	const append = (items: NoteFolderNode[]) => {
		for (const node of items) {
			flattened.push(node);
			append(node.children);
		}
	};
	append(nodes);
	return flattened;
}
