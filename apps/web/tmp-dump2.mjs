import { DOMParser } from 'linkedom';
const d1 = new DOMParser().parseFromString('<body><p>x</p></body>', 'text/html');
console.log('d1 body:', JSON.stringify(d1.body?.innerHTML), 'doc:', JSON.stringify(d1.documentElement?.innerHTML));
const d2 = new DOMParser().parseFromString('<p>x</p>', 'text/html');
console.log('d2 body:', JSON.stringify(d2.body?.innerHTML));
