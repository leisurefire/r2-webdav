import { describe, expect, it } from 'vitest';
import type { NoteFolder } from '@r2-webdav/shared-types';
import {
	buildNoteFolderTree,
	canMoveNoteFolder,
	flattenNoteFolderTree,
	noteFolderDescendantIds,
	noteFolderPath,
} from './folderTree';

function folder(id: string, name: string, parentId: string | null = null): NoteFolder {
	return { id, name, parentId, noteCount: 0, createdAt: '', updatedAt: '' };
}

const folders = [folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b'), folder('d', 'D')];

describe('note folder tree', () => {
	it('builds nested folders and preserves their path', () => {
		const tree = buildNoteFolderTree(folders);
		expect(tree.map((node) => node.folder.id)).toEqual(['a', 'd']);
		expect(flattenNoteFolderTree(tree).map((node) => node.folder.id)).toEqual(['a', 'b', 'c', 'd']);
		expect(noteFolderPath(folders, 'c').map((item) => item.name)).toEqual(['A', 'B', 'C']);
	});

	it('rejects self and descendant destinations', () => {
		expect([...noteFolderDescendantIds(folders, 'a')]).toEqual(expect.arrayContaining(['b', 'c']));
		expect(canMoveNoteFolder(folders, 'a', 'a')).toBe(false);
		expect(canMoveNoteFolder(folders, 'a', 'c')).toBe(false);
		expect(canMoveNoteFolder(folders, 'c', 'a')).toBe(true);
		expect(canMoveNoteFolder(folders, 'c', null)).toBe(true);
	});

	it('keeps orphaned and cyclic data reachable at the root', () => {
		const malformed = [folder('orphan', 'Orphan', 'missing'), folder('x', 'X', 'y'), folder('y', 'Y', 'x')];
		const ids = flattenNoteFolderTree(buildNoteFolderTree(malformed)).map((node) => node.folder.id);
		expect(ids).toEqual(expect.arrayContaining(['orphan', 'x', 'y']));
	});
});
