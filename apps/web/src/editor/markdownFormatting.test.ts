import { describe, expect, it } from 'vitest';
import { markdownMarkerCoverage, markdownWrapEdit } from './markdownFormatting';

function apply(doc: string, from: number, to: number, marker = '**'): string {
	const edit = markdownWrapEdit(doc, from, to, marker);
	return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}

describe('markdownWrapEdit', () => {
	it('wraps an unformatted selection', () => {
		expect(apply('alpha beta', 6, 10)).toBe('alpha **beta**');
	});

	it('removes a wrapper from its complete content', () => {
		expect(apply('**bold**', 2, 6)).toBe('bold');
	});

	it('extends an overlapping wrapper instead of nesting another wrapper', () => {
		const source = '**12**3123';
		expect(apply(source, 3, source.length)).toBe('**123123**');
	});

	it('extends a directly adjacent wrapper', () => {
		const source = '**bold** plain';
		expect(apply(source, 8, source.length)).toBe('**bold plain**');
	});

	it('merges formatted islands crossed by the selection', () => {
		const source = '**one** and **two**';
		expect(apply(source, 3, 16)).toBe('**one and two**');
	});

	it('removes formatting only from a selected subsection', () => {
		expect(apply('**abcd**', 3, 5)).toBe('**a**bc**d**');
	});

	it('reports partial and full marker coverage', () => {
		expect(markdownMarkerCoverage('**bold** plain', 2, 6, '**')).toBe('full');
		expect(markdownMarkerCoverage('**bold** plain', 4, 12, '**')).toBe('partial');
		expect(markdownMarkerCoverage('plain', 0, 5, '**')).toBe('none');
	});
});
