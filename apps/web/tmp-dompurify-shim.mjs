import { parseHTML, DOMParser as LinkeDOMParser } from 'linkedom';
import createDOMPurify from 'C:/Users/leisu/CodeBase/r2-webdav/node_modules/dompurify/dist/purify.es.mjs';
const dom = parseHTML('<html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.DOMParser = LinkeDOMParser;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;
export default createDOMPurify(dom.window);
