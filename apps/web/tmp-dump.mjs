import { parseMarkdownBlocks } from './src/editor/markdownRenderer';
const cases = {
  tight: `> [!note] t\n> 1. aaa\n> 2. bbb`,
  looseBlank: `> [!note] t\n> 1. aaa\n>\n> 2. bbb`,
  looseBlankBefore: `> [!note] t\n>\n> 1. aaa\n> 2. bbb`,
  plainQuoteList: `> 1. aaa\n>\n> 2. bbb`,
  plainList: `1. aaa\n\n2. bbb`,
};
for (const [k, v] of Object.entries(cases)) {
  console.log('=== ' + k + ' ===');
  console.log(JSON.stringify(parseMarkdownBlocks(v)));
}
