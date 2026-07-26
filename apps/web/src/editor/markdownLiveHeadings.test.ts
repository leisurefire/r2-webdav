import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { collectLiveMarkdownHeadings } from './markdownLiveHeadings';

describe('collectLiveMarkdownHeadings', () => {
	it('collects positions, levels, and duplicate ids from the syntax tree', () => {
		const source = '# **Overview**\n\nDetails\n-------\n\n# Overview';
		const state = EditorState.create({ doc: source, extensions: [markdown({ extensions: GFM })] });

		expect(collectLiveMarkdownHeadings(state)).toEqual([
			{ id: 'overview', level: 1, text: 'Overview', from: 0 },
			{ id: 'details', level: 2, text: 'Details', from: source.indexOf('Details') },
			{ id: 'overview-2', level: 1, text: 'Overview', from: source.lastIndexOf('# Overview') },
		]);
	});
});
